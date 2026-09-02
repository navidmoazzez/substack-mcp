/**
 * Resolving credentials, and the multi-publication model.
 *
 * Three sources, in priority order:
 *   1. SUBSTACK_PUBLICATIONS  a JSON array, for several publications at once
 *   2. SUBSTACK_*             the single-publication environment variables
 *   3. ~/.substack-mcp/session.json  whatever `substack-mcp login` captured
 *
 * One Substack login often owns more than one publication. Every tool that
 * touches a specific publication takes an optional `publication` argument
 * matched loosely against the hostname, defaulting to the first configured one.
 */

import { loadSession } from "./auth/session.js";

export type Credentials = {
  publicationUrl: string;
  sessionToken: string;
  userId?: string;
};

export type Config = {
  publications: Credentials[];
  readOnly: boolean;
  allowDestructive: boolean;
  requestTimeoutMs: number;
  userAgent: string;
  minRequestIntervalMs: number;
  maxRetries: number;
  auditPath?: string;
};

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Strip scheme, path and trailing slashes down to a bare hostname. */
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .split("/")[0]!
    .toLowerCase();
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(
      `[substack-mcp] ${name}="${raw}" is not a positive number. Using ${fallback}.\n`,
    );
    return fallback;
  }
  return n;
}

function fromPublicationsEnv(): Credentials[] {
  const raw = process.env.SUBSTACK_PUBLICATIONS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Credentials[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const url = e.publication_url ?? e.publicationUrl ?? e.url;
      const token = e.session_token ?? e.sessionToken ?? e.token;
      if (typeof url === "string" && typeof token === "string" && url && token) {
        const userId = e.user_id ?? e.userId;
        out.push({
          publicationUrl: normalizeHost(url),
          sessionToken: token,
          userId: typeof userId === "string" || typeof userId === "number"
            ? String(userId)
            : undefined,
        });
      }
    }
    return out;
  } catch {
    process.stderr.write(
      "[substack-mcp] SUBSTACK_PUBLICATIONS is not valid JSON. Ignoring it.\n",
    );
    return [];
  }
}

function fromSingleEnv(): Credentials[] {
  const url = process.env.SUBSTACK_PUBLICATION_URL;
  const token = process.env.SUBSTACK_SESSION_TOKEN;
  if (!url || !token) return [];
  return [
    {
      publicationUrl: normalizeHost(url),
      sessionToken: token,
      userId: process.env.SUBSTACK_USER_ID || undefined,
    },
  ];
}

function fromStoredSession(): Credentials[] {
  const stored = loadSession();
  if (!stored) return [];
  return [
    {
      publicationUrl: normalizeHost(stored.publication_url),
      sessionToken: stored.session_token,
      userId: stored.user_id,
    },
  ];
}

export function loadConfig(): Config {
  const publications =
    fromPublicationsEnv().length > 0
      ? fromPublicationsEnv()
      : fromSingleEnv().length > 0
        ? fromSingleEnv()
        : fromStoredSession();

  return {
    publications,
    readOnly: envFlag("SUBSTACK_READ_ONLY", false),
    allowDestructive: envFlag("SUBSTACK_ALLOW_DESTRUCTIVE", true),
    requestTimeoutMs: envInt("SUBSTACK_REQUEST_TIMEOUT_MS", 30_000),
    userAgent: process.env.SUBSTACK_USER_AGENT || DEFAULT_USER_AGENT,
    minRequestIntervalMs: envInt("SUBSTACK_MIN_REQUEST_INTERVAL_MS", 350),
    maxRetries: envInt("SUBSTACK_MAX_RETRIES", 3),
    auditPath: process.env.SUBSTACK_AUDIT_LOG || undefined,
  };
}

/**
 * Pick which publication a call targets.
 *
 * `hint` is matched loosely against the hostname so "example" finds
 * "example.substack.com". With no hint, the first configured publication wins.
 */
export function selectPublication(
  config: Config,
  hint?: string,
): Credentials {
  if (config.publications.length === 0) {
    throw new Error(
      "No Substack credentials configured. Set SUBSTACK_PUBLICATION_URL and SUBSTACK_SESSION_TOKEN, or run `substack-mcp login`. See https://github.com/navidmoazzez/substack-mcp-cli#3-setup-",
    );
  }
  if (!hint) return config.publications[0]!;

  const needle = normalizeHost(hint);
  const exact = config.publications.find((p) => p.publicationUrl === needle);
  if (exact) return exact;

  const loose = config.publications.find(
    (p) => p.publicationUrl.includes(needle) || needle.includes(p.publicationUrl),
  );
  if (loose) return loose;

  const known = config.publications.map((p) => p.publicationUrl).join(", ");
  throw new Error(
    `No connected publication matches "${hint}". Connected: ${known || "(none)"}`,
  );
}
