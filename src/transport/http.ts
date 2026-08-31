/**
 * The HTTP transport.
 *
 * stdio is the default and what nearly everyone uses. This exists for the one
 * case stdio cannot cover: running the server somewhere that is always on, so
 * scheduled Notes fire whether or not your laptop is open, and so a hosted
 * client can reach it.
 *
 * Two things it does that a naive implementation gets wrong, both of which are
 * how local MCP servers get attacked from a web page:
 *   - Origin is validated, so a site you visit cannot drive your server through
 *     a cross-origin request.
 *   - It binds to localhost unless told otherwise, so it is not exposed to the
 *     network by accident.
 *
 * Exposing it beyond localhost means putting it behind something that does TLS
 * and authentication. There is a bearer-token option here, but it is a lock on
 * one door, not a security model.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BuiltServer } from "../server.js";

export type HttpOptions = {
  port: number;
  host: string;
  /** Required in the Authorization header when set. */
  token?: string;
  /** Extra Origin values to accept beyond localhost. */
  allowedOrigins: string[];
};

export function httpOptionsFromEnv(argv: string[]): HttpOptions {
  const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const hostArg = argv.find((a) => a.startsWith("--host="))?.split("=")[1];

  return {
    port: Number(portArg ?? process.env.SUBSTACK_MCP_PORT ?? 8788),
    host: hostArg ?? process.env.SUBSTACK_MCP_HOST ?? "127.0.0.1",
    token: process.env.SUBSTACK_MCP_TOKEN || undefined,
    allowedOrigins: (process.env.SUBSTACK_MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/** Constant-time compare, so a token cannot be guessed a character at a time. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function startHttpServer(
  built: BuiltServer,
  options: HttpOptions,
): Promise<{ close: () => Promise<void> }> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await built.server.connect(transport);

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && !isLocalOrigin(origin) && !options.allowedOrigins.includes(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Origin ${origin} is not allowed. Add it to SUBSTACK_MCP_ALLOWED_ORIGINS if this is deliberate.`,
        }),
      );
      return;
    }

    if (options.token) {
      const header = req.headers.authorization ?? "";
      const provided = header.replace(/^Bearer\s+/i, "");
      if (!provided || !tokenMatches(provided, options.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid bearer token." }));
        return;
      }
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          tools: built.toolCount,
          publications: built.config.publications.length,
          read_only: built.config.readOnly,
        }),
      );
      return;
    }

    void transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => {
    http.listen(options.port, options.host, resolve);
  });

  process.stderr.write(
    `[substack-mcp] HTTP transport on http://${options.host}:${options.port} (${built.toolCount} tools)${options.token ? " with bearer auth" : ""}\n`,
  );
  if (options.host !== "127.0.0.1" && options.host !== "localhost" && !options.token) {
    process.stderr.write(
      "[substack-mcp] WARNING: bound beyond localhost with no SUBSTACK_MCP_TOKEN set. Anyone who can reach this port controls your Substack.\n",
    );
  }

  return {
    close: async () => {
      await transport.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
