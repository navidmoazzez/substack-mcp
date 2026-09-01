#!/usr/bin/env node
/**
 * Entry point.
 *
 * `substack-mcp`             stdio, which is what MCP clients launch
 * `substack-mcp --http`      HTTP, for running it somewhere always on
 * `substack-mcp login`       capture a session from a browser, once
 * `substack-mcp doctor`      check the setup and say what is wrong
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { loadConfig } from "./config.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";

const HELP = `substack-mcp ${VERSION}

  substack-mcp                    Run over stdio. This is what an MCP client launches.
  substack-mcp --http [--port=N]  Run over HTTP, for a machine that is always on.
  substack-mcp login [url]        Capture a session from a browser, once.
  substack-mcp doctor             Check the setup and report what is wrong.
  substack-mcp --version          Print the version.

Credentials, in priority order:
  SUBSTACK_PUBLICATIONS     JSON array, for several publications at once
  SUBSTACK_PUBLICATION_URL  your publication, e.g. example.substack.com
  SUBSTACK_SESSION_TOKEN    the connect.sid cookie value
  SUBSTACK_USER_ID          optional, resolved automatically when absent
  ~/.substack-mcp/session.json   whatever \`substack-mcp login\` captured

Options:
  SUBSTACK_READ_ONLY=1              disable every write
  SUBSTACK_ALLOW_DESTRUCTIVE=0      keep writes, block the irreversible ones
  SUBSTACK_REQUEST_TIMEOUT_MS       per-request deadline, default 30000
  SUBSTACK_MIN_REQUEST_INTERVAL_MS  spacing between requests, default 350
  SUBSTACK_AUDIT_LOG                append-only log of every attempted write

https://github.com/navidmoazzez/substack-mcp
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (command === "login") {
    // Imported here, not at the top: the browser drivers are optional and
    // heavy, and the server itself must never pay to load them.
    const { runLogin } = await import("./auth/login.js");
    await runLogin(argv.slice(1));
    return;
  }

  if (command === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
    return;
  }

  const config = loadConfig();
  const built = buildServer(config);

  // Warn, never block. A network check at startup would delay the handshake,
  // and the failure is more actionable on the tool call that hits it.
  if (config.publications.length === 0) {
    process.stderr.write(
      "[substack-mcp] No credentials configured. Discovery tools still work; everything else will report the missing setup. Run `substack-mcp doctor` for details.\n",
    );
  }

  const shutdown = async (close?: () => Promise<void>): Promise<void> => {
    built.scheduler.stop();
    if (close) await close().catch(() => undefined);
    process.exit(0);
  };

  if (argv.includes("--http")) {
    const { close } = await startHttpServer(built, httpOptionsFromEnv(argv));
    built.scheduler.start();
    process.on("SIGTERM", () => void shutdown(close));
    process.on("SIGINT", () => void shutdown(close));
    return;
  }

  const transport = new StdioServerTransport();
  await built.server.connect(transport);
  built.scheduler.start();

  // Handled so `docker stop` and a client shutting down return promptly rather
  // than waiting out a grace period.
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[substack-mcp] ${(error as Error).message}\n`);
  process.exit(1);
});
