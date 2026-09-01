/**
 * The one place every Substack request goes through.
 *
 * Substack publishes no REST API. These are the same authenticated JSON
 * endpoints the web app calls, signed with a `connect.sid` session cookie, and
 * they can change without notice. Routing everything through one client means a
 * change upstream is fixed in one file.
 *
 * What this adds over a bare fetch:
 *   - a real deadline. Node applies no request timeout, only a 10s connect
 *     timeout, so a host that accepts the connection and then goes quiet would
 *     otherwise hang a tool call forever.
 *   - retries with backoff on 429 and 5xx, which are the two failures that
 *     actually resolve by waiting.
 *   - a floor on request spacing, so a model looping over 200 posts does not
 *     get the account rate limited.
 *   - a browser User-Agent and Referer, because publications on custom domains
 *     sit behind Cloudflare and it blocks unrecognized clients with 1010.
 */

import type { Config, Credentials } from "../config.js";
import { errorForStatus, ServerError, SubstackError, TimeoutError } from "./errors.js";

export type FetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send the session cookie. Off for public endpoints. */
  authenticated?: boolean;
  /** Override the credentials for this one call. */
  creds?: Credentials;
  /** Accept a non-JSON response body without treating it as an error. */
  raw?: boolean;
  /** Extra headers, merged last. */
  headers?: Record<string, string>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class SubstackClient {
  private readonly config: Config;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: Config) {
    this.config = config;
  }

  /** `https://example.substack.com` for a set of credentials. */
  baseUrl(creds: Credentials): string {
    return `https://${creds.publicationUrl}`;
  }

  /** `https://example.substack.com/api/v1` */
  apiUrl(creds: Credentials): string {
    return `${this.baseUrl(creds)}/api/v1`;
  }

  private headers(opts: FetchOptions): Record<string, string> {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": this.config.userAgent,
      Accept: "application/json, text/html, */*",
    };

    if (opts.authenticated !== false && opts.creds) {
      // Substack has used both cookie names across releases. Sending both is
      // harmless and survives whichever one the account was issued.
      base.Cookie = `substack.sid=${opts.creds.sessionToken}; connect.sid=${opts.creds.sessionToken};`;
      base.Referer = this.baseUrl(opts.creds);
      base.Origin = this.baseUrl(opts.creds);
    }

    return { ...base, ...(opts.headers ?? {}) };
  }

  /**
   * Space requests out. Serialised through a promise chain so concurrent tool
   * calls queue rather than all firing at once.
   */
  private throttle<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const gap = Date.now() - this.lastRequestAt;
      const wait = this.config.minRequestIntervalMs - gap;
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      return work();
    });
    // Keep the chain alive even when a call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async request<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
    return this.throttle(() => this.attempt<T>(url, opts, 0));
  }

  private async attempt<T>(
    url: string,
    opts: FetchOptions,
    attemptNumber: number,
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const endpoint = redactUrl(url);

    const init: RequestInit = {
      method,
      headers: this.headers(opts),
    };
    if (opts.body !== undefined && method !== "GET") {
      init.body =
        typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    init.signal = controller.signal;

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new TimeoutError(
          `No response from Substack within ${this.config.requestTimeoutMs}ms. Raise SUBSTACK_REQUEST_TIMEOUT_MS if your network is slow.`,
          408,
          endpoint,
        );
      }
      // DNS failure, connection refused, TLS error. Worth one retry.
      if (attemptNumber < this.config.maxRetries) {
        await sleep(backoffMs(attemptNumber));
        return this.attempt<T>(url, opts, attemptNumber + 1);
      }
      throw new ServerError(
        `Could not reach Substack: ${(err as Error).message}`,
        0,
        endpoint,
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (RETRYABLE.has(res.status) && attemptNumber < this.config.maxRetries) {
        await sleep(backoffMs(attemptNumber, res.headers.get("retry-after")));
        return this.attempt<T>(url, opts, attemptNumber + 1);
      }
      throw errorForStatus(res.status, endpoint, text);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (opts.raw) return (await res.text()) as T;
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as T;
  }

  /** GET that returns `null` instead of throwing on 404. */
  async tryRequest<T = unknown>(
    url: string,
    opts: FetchOptions = {},
  ): Promise<T | null> {
    try {
      return await this.request<T>(url, opts);
    } catch (err) {
      if (err instanceof SubstackError && err.status === 404) return null;
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, honouring Retry-After when present. */
function backoffMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  const base = Math.min(1000 * 2 ** attempt, 15_000);
  return base + Math.floor(Math.random() * 250);
}

/**
 * Strip anything sensitive out of a URL before it goes into an error message.
 * Error text reaches the model and often the user's screen.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["token", "session", "email", "api_key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "REDACTED");
    }
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
