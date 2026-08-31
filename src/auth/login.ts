/**
 * Capturing a session, once.
 *
 * The cookie is the fast path and stays the default everywhere else in this
 * server: it costs nothing, needs no browser, and every request uses it
 * directly. This file only exists to make getting that cookie less annoying
 * than digging through DevTools.
 *
 * Three ways, in the order they are worth trying:
 *
 *   --paste       (default) prompts you and stores what you paste. Instant, no
 *                 dependencies, works everywhere.
 *   --playwriter  reads the cookie out of the Chrome you already have open,
 *                 where you are already signed in. No launch, no sign-in.
 *   --playwright  launches its own browser and waits for you to sign in. The
 *                 slowest by a distance, and the only one that works headless
 *                 or on a machine with no Chrome.
 *
 * None of this runs while the server is running. `substack-mcp login` is a
 * separate command, and the drivers are imported inside it, so the server never
 * loads a browser and startup stays instant.
 */

import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import { normalizeHost } from "../config.js";
import { saveSession, sessionPath, type StoredSession } from "./session.js";

const COOKIE_NAMES = ["connect.sid", "substack.sid"];

type Mode = "paste" | "playwriter" | "playwright";

function parseMode(argv: string[]): Mode {
  if (argv.includes("--playwriter")) return "playwriter";
  if (argv.includes("--playwright")) return "playwright";
  return "paste";
}

export async function runLogin(argv: string[]): Promise<void> {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const mode = parseMode(argv);

  let publicationUrl = positional[0];
  if (!publicationUrl) {
    publicationUrl = await ask(
      "Your publication URL (for example example.substack.com): ",
    );
  }
  const host = normalizeHost(publicationUrl);
  if (!host) {
    throw new Error("A publication URL is required.");
  }

  const token =
    mode === "playwriter"
      ? await captureWithPlaywriter(host)
      : mode === "playwright"
        ? await captureWithPlaywright(host)
        : await captureByPaste();

  const session: StoredSession = {
    publication_url: host,
    session_token: token,
    user_id: await resolveUserId(host, token),
    captured_at: new Date().toISOString(),
  };

  const path = saveSession(session);

  stdout.write(`\nSaved to ${path}\n`);
  stdout.write(
    `Encrypted with a key derived from this machine and account, and written 0600.\n`,
  );
  stdout.write(`Publication: ${host}\n`);
  stdout.write(`User id: ${session.user_id ?? "(resolved at run time)"}\n\n`);
  stdout.write(
    `The server reads this automatically, so you can leave the SUBSTACK_* variables out of your client config entirely.\n`,
  );
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function captureByPaste(): Promise<string> {
  stdout.write(`
To find your session cookie:

  1. Open your publication in a browser and sign in.
  2. Open DevTools, then Application, then Cookies.
  3. Copy the value of connect.sid. It is a long string starting with s%3A.

Turn off any ad blocker first: some of them strip the cookie from the panel.

`);
  const value = await ask("Paste connect.sid: ");
  if (!value) throw new Error("Nothing pasted.");
  if (!/^s%3A|^s:/.test(value)) {
    stdout.write(
      "\nThat does not look like a connect.sid value, which normally starts with s%3A. Saving it anyway; run `substack-mcp doctor` to check whether it works.\n",
    );
  }
  return value;
}

/**
 * Read the cookie out of the browser the user already has open.
 *
 * Playwriter drives their real Chrome over a local extension, so there is no
 * launch and no sign-in: the session is already there. It is a separate,
 * proprietary tool, so it is detected at run time rather than depended on.
 */
async function captureWithPlaywriter(host: string): Promise<string> {
  stdout.write("Looking for playwriter...\n");

  const version = await run("playwriter", ["--version"]).catch(() => null);
  if (version === null) {
    throw new Error(
      `playwriter is not installed. Either install it and its Chrome extension from https://playwriter.dev, or use one of:

  substack-mcp login ${host}                 paste the cookie (fastest)
  substack-mcp login ${host} --playwright    launch a browser instead`,
    );
  }

  const session = (await run("playwriter", ["session", "new"])).trim().split(/\s+/).pop();
  if (!session) throw new Error("playwriter did not return a session id.");

  const script = `
    await page.goto("https://${host}");
    const cookies = await page.context().cookies();
    const match = cookies.find(c => ${JSON.stringify(COOKIE_NAMES)}.includes(c.name));
    console.log(match ? "TOKEN:" + match.value : "TOKEN:");
  `.trim();

  const output = await run("playwriter", ["-s", session, "-e", script]);
  const token = output.match(/TOKEN:(\S*)/)?.[1];

  if (!token) {
    throw new Error(
      `No Substack session cookie found in your browser for ${host}. Sign in to Substack in the Chrome that playwriter is connected to, then run this again.`,
    );
  }
  stdout.write("Captured from your open browser.\n");
  return token;
}

/**
 * The slice of Playwright this uses.
 *
 * Declared locally rather than imported: Playwright is an optional peer
 * dependency, so its types are not present in a normal install and importing
 * them would break the build for everyone who never wanted a browser.
 */
type PlaywrightCookie = { name: string; value: string };
type PlaywrightContext = {
  newPage(): Promise<{ goto(url: string): Promise<unknown> }>;
  cookies(): Promise<PlaywrightCookie[]>;
};
type PlaywrightModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<{
      newContext(): Promise<PlaywrightContext>;
      close(): Promise<void>;
    }>;
  };
};

/** Launch a browser and wait for the user to sign in. The slow path. */
async function captureWithPlaywright(host: string): Promise<string> {
  let chromium: PlaywrightModule["chromium"];
  try {
    // A variable specifier, so TypeScript does not try to resolve a module that
    // is deliberately absent from most installs.
    const specifier = "playwright";
    ({ chromium } = (await import(specifier)) as PlaywrightModule);
  } catch {
    throw new Error(
      `Playwright is not installed. It is large, so it is not bundled:

  npm i -g playwright && npx playwright install chromium

Or skip it entirely:

  substack-mcp login ${host}                 paste the cookie (fastest)
  substack-mcp login ${host} --playwriter    use the Chrome you already have open`,
    );
  }

  stdout.write("Launching a browser. Sign in to Substack, then come back here.\n");

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`https://${host}/sign-in`);

    // Poll rather than waiting on navigation: sign-in can take several steps,
    // including a CAPTCHA and an emailed link, and the cookie is the only
    // reliable signal that it finished.
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      const match = cookies.find((c) => COOKIE_NAMES.includes(c.name));
      if (match?.value) {
        stdout.write("Signed in, cookie captured.\n");
        return match.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Timed out after 10 minutes waiting for sign-in.");
  } finally {
    await browser.close();
  }
}

/** Look up the numeric user id so the server does not have to on first use. */
async function resolveUserId(host: string, token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://${host}/api/v1/publication_user`, {
      headers: {
        Cookie: `substack.sid=${token}; connect.sid=${token};`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { user?: { id?: number }; id?: number };
    const id = data.user?.id ?? data.id;
    return id === undefined ? undefined : String(id);
  } catch {
    return undefined;
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${command} exited with ${String(code)}`));
    });
  });
}

export { sessionPath };
