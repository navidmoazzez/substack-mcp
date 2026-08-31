/**
 * `substack-mcp doctor`
 *
 * Every failure mode of a session-cookie integration looks the same from
 * inside an MCP client: a tool returns an error and the user has no way to tell
 * an expired cookie from a wrong publication URL from Cloudflare blocking a
 * custom domain. This runs the checks in order and names the actual problem.
 */

import { SubstackClient } from "./api/client.js";
import { AuthenticationError, SubstackError } from "./api/errors.js";
import { loadConfig } from "./config.js";
import { loadSession, sessionPath } from "./auth/session.js";
import { ALL_TOOLS } from "./tools/index.js";
import { resolveUserId } from "./api/identity.js";

const ok = (message: string): void => {
  process.stdout.write(`  ok    ${message}\n`);
};
const warn = (message: string): void => {
  process.stdout.write(`  warn  ${message}\n`);
};
const bad = (message: string): void => {
  process.stdout.write(`  FAIL  ${message}\n`);
};

export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  let failures = 0;

  process.stdout.write("\nsubstack-mcp doctor\n\n");

  process.stdout.write("Credentials\n");
  if (config.publications.length === 0) {
    bad("No credentials found.");
    process.stdout.write(
      `\n        Set SUBSTACK_PUBLICATION_URL and SUBSTACK_SESSION_TOKEN, or run:\n          substack-mcp login\n`,
    );
    return 1;
  }

  const stored = loadSession();
  if (stored) {
    ok(`Stored session at ${sessionPath()}, captured ${stored.captured_at}`);
    const ageDays = Math.floor(
      (Date.now() - new Date(stored.captured_at).getTime()) / 86_400_000,
    );
    if (ageDays > 75) {
      warn(
        `That session is ${ageDays} days old. Substack cookies expire around 90 days, so a refresh is due soon.`,
      );
    }
  } else if (process.env.SUBSTACK_PUBLICATIONS) {
    ok("Credentials from SUBSTACK_PUBLICATIONS");
  } else {
    ok("Credentials from SUBSTACK_* environment variables");
  }
  ok(`${config.publications.length} publication(s) configured`);

  process.stdout.write("\nConfiguration\n");
  ok(`Request timeout ${config.requestTimeoutMs}ms, ${config.maxRetries} retries`);
  ok(`Minimum ${config.minRequestIntervalMs}ms between requests`);
  if (config.readOnly) {
    warn("SUBSTACK_READ_ONLY is on: every write tool is hidden and refused.");
  } else if (!config.allowDestructive) {
    warn("SUBSTACK_ALLOW_DESTRUCTIVE is off: publish and delete are refused.");
  } else {
    ok("Writes enabled. Irreversible actions still require confirm: true.");
  }
  ok(`${config.readOnly ? ALL_TOOLS.filter((t) => t.risk === "read").length : ALL_TOOLS.length} tools exposed`);

  const client = new SubstackClient(config);

  for (const creds of config.publications) {
    process.stdout.write(`\n${creds.publicationUrl}\n`);

    if (!/\.substack\.com$/i.test(creds.publicationUrl)) {
      warn(
        "This is a custom domain. Substack serves those behind Cloudflare, which can answer 403 error 1010. If calls fail, use the canonical *.substack.com host instead.",
      );
    }

    try {
      const publication = await client.request<Record<string, unknown>>(
        `${client.apiUrl(creds)}/publication`,
        { creds },
      );
      ok(`Authenticated as "${String(publication.name ?? "unknown")}"`);

      const sections = Array.isArray(publication.sections) ? publication.sections.length : 0;
      ok(`${sections} section(s)`);

      const userId = await resolveUserId(client, creds);
      if (userId === undefined) {
        warn(
          "Could not resolve the user id. Drafts need a byline, so set SUBSTACK_USER_ID if create_draft fails.",
        );
      } else {
        ok(`User id ${userId}${creds.userId ? "" : " (resolved automatically)"}`);
      }
    } catch (error) {
      failures++;
      if (error instanceof AuthenticationError) {
        bad(error.message);
      } else if (error instanceof SubstackError) {
        bad(`${error.name}: ${error.message}`);
      } else {
        bad((error as Error).message);
      }
    }
  }

  process.stdout.write(
    failures === 0
      ? "\nEverything checks out.\n\n"
      : `\n${failures} publication(s) failed. Fix the above, then run this again.\n\n`,
  );
  return failures === 0 ? 0 : 1;
}
