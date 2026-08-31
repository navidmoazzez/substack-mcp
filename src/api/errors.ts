/**
 * Typed errors for every way a Substack call can fail.
 *
 * Substack has no public API. We call the same authenticated JSON endpoints the
 * web app calls, so failures arrive in three different shapes: a JSON body, a
 * plain-text body, or a multi-kilobyte Cloudflare HTML block page. A single
 * "Substack API error" string for all of them tells the calling model nothing
 * it can act on, so each status maps to a class with a message that names the
 * actual fix.
 */

export class SubstackError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly detail: string;

  constructor(message: string, status: number, endpoint: string, detail = "") {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.endpoint = endpoint;
    this.detail = detail;
  }

  /** What the model should show the user. Includes the actionable hint. */
  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      type: this.name,
      status: this.status,
      endpoint: this.endpoint,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/** 401/403, or a Cloudflare 1010 block on a custom domain. */
export class AuthenticationError extends SubstackError {}

/** 429. Substack does not send Retry-After, so the client backs off on its own. */
export class RateLimitError extends SubstackError {}

/** 400 — bad arguments reached the endpoint. */
export class ValidationError extends SubstackError {}

/** 404 — the draft, post, note or publication does not exist. */
export class NotFoundError extends SubstackError {}

/** 5xx — Substack's problem, worth retrying. */
export class ServerError extends SubstackError {}

/** Synthetic 408. No response arrived before our own deadline. */
export class TimeoutError extends SubstackError {}

/** The server is running with writes disabled, or a confirm was missing. */
export class WriteBlockedError extends SubstackError {
  constructor(message: string) {
    super(message, 0, "(local)", "");
  }
}

/**
 * Pull something readable out of a response body.
 *
 * Tries JSON first (`{error}` / `{errors:[]}` / `{message}`), falls back to raw
 * text. Caps at 500 characters so a Cloudflare HTML block page does not become
 * the entire error message.
 */
export function extractErrorDetail(body: string): string {
  const text = body.trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") return parsed.slice(0, 500);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.error === "string") return obj.error.slice(0, 500);
      if (typeof obj.message === "string") return obj.message.slice(0, 500);
      if (Array.isArray(obj.errors)) {
        return obj.errors
          .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
          .join("; ")
          .slice(0, 500);
      }
    }
  } catch {
    // Not JSON. Fall through to the raw text.
  }

  return text.replace(/\s+/g, " ").slice(0, 500);
}

/** True when a Cloudflare block page is pretending to be an auth failure. */
export function isCloudflareBlock(body: string): boolean {
  return /error code: 1010|Cloudflare Ray ID|Attention Required!/i.test(body);
}

/** Map an HTTP status onto the right error class. */
export function errorForStatus(
  status: number,
  endpoint: string,
  body: string,
): SubstackError {
  const detail = extractErrorDetail(body);

  if (status === 401 || status === 403) {
    if (isCloudflareBlock(body)) {
      return new AuthenticationError(
        "Cloudflare blocked the request (error 1010). Set SUBSTACK_PUBLICATION_URL to the publication's canonical *.substack.com host rather than a custom domain.",
        status,
        endpoint,
        detail,
      );
    }
    return new AuthenticationError(
      "Substack rejected the session. The token has most likely expired — sign in again and copy a fresh connect.sid, or re-run `substack-mcp login`.",
      status,
      endpoint,
      detail,
    );
  }
  if (status === 429) {
    return new RateLimitError(
      "Substack rate limited the request. The client already backs off and retries; this failed after the last attempt.",
      status,
      endpoint,
      detail,
    );
  }
  if (status === 400) {
    return new ValidationError(
      `Substack rejected the arguments sent to ${endpoint}.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status === 404) {
    return new NotFoundError(
      `Not found: ${endpoint}. Check the id, slug or publication.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status >= 500) {
    return new ServerError(
      `Substack returned ${status}. This is upstream and usually transient.`,
      status,
      endpoint,
      detail,
    );
  }
  return new SubstackError(
    `Substack returned ${status} for ${endpoint}.`,
    status,
    endpoint,
    detail,
  );
}
