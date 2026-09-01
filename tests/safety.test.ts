import { describe, expect, it } from "vitest";
import { annotationsFor, WriteGuard } from "../src/safety.js";
import { WriteBlockedError } from "../src/api/errors.js";
import { DEFAULT_USER_AGENT, normalizeHost, selectPublication, type Config } from "../src/config.js";

function config(overrides: Partial<Config> = {}): Config {
  return {
    publications: [
      { publicationUrl: "example.substack.com", sessionToken: "t", userId: "1" },
      { publicationUrl: "second.substack.com", sessionToken: "t2" },
    ],
    readOnly: false,
    allowDestructive: true,
    requestTimeoutMs: 30_000,
    userAgent: DEFAULT_USER_AGENT,
    minRequestIntervalMs: 350,
    maxRetries: 3,
    ...overrides,
  };
}

describe("write guard", () => {
  it("lets reads through with no confirmation", () => {
    const guard = new WriteGuard(config());
    expect(() => guard.check("list_drafts", "read", undefined, "")).not.toThrow();
  });

  it("lets an ordinary write through with no confirmation", () => {
    const guard = new WriteGuard(config());
    expect(() => guard.check("create_draft", "write", undefined, "create a draft")).not.toThrow();
  });

  it("refuses an irreversible action without confirm", () => {
    const guard = new WriteGuard(config());
    expect(() => guard.check("publish_draft", "destructive", undefined, "email everyone")).toThrow(
      WriteBlockedError,
    );
  });

  it("says what would have happened when it refuses", () => {
    const guard = new WriteGuard(config());
    expect(() =>
      guard.check("publish_draft", "destructive", undefined, "email every subscriber"),
    ).toThrow(/email every subscriber/);
  });

  it("allows an irreversible action once confirmed", () => {
    const guard = new WriteGuard(config());
    expect(() =>
      guard.check("publish_draft", "destructive", true, "email everyone"),
    ).not.toThrow();
  });

  it("blocks every write in read-only mode, confirmed or not", () => {
    const guard = new WriteGuard(config({ readOnly: true }));
    expect(() => guard.check("create_draft", "write", undefined, "")).toThrow(/READ_ONLY/);
    expect(() => guard.check("publish_draft", "destructive", true, "")).toThrow(/READ_ONLY/);
  });

  it("can keep ordinary writes while blocking irreversible ones", () => {
    const guard = new WriteGuard(config({ allowDestructive: false }));
    expect(() => guard.check("create_draft", "write", undefined, "")).not.toThrow();
    expect(() => guard.check("delete_draft", "destructive", true, "")).toThrow(/DESTRUCTIVE/);
  });
});

describe("annotations", () => {
  it("marks reads read-only and not destructive", () => {
    expect(annotationsFor("read")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      // Every call in this server reaches Substack, reads included.
      openWorldHint: true,
    });
  });

  it("marks a reversible write idempotent, an irreversible one not", () => {
    expect(annotationsFor("write").idempotentHint).toBe(true);
    expect(annotationsFor("destructive").idempotentHint).toBe(false);
  });

  it("never leaves destructiveHint to the MCP default of true on a read", () => {
    // An omitted destructiveHint defaults to true, which would show every read
    // tool in a client as dangerous.
    expect(annotationsFor("read").destructiveHint).toBe(false);
  });

  it("marks destructive tools as destructive and outward-facing", () => {
    const a = annotationsFor("destructive");
    expect(a.destructiveHint).toBe(true);
    expect(a.readOnlyHint).toBe(false);
    expect(a.openWorldHint).toBe(true);
    expect(a.idempotentHint).toBe(false);
  });

  it("sets openWorldHint on everything, because every call leaves the machine", () => {
    for (const risk of ["read", "write", "destructive"] as const) {
      expect(annotationsFor(risk).openWorldHint, risk).toBe(true);
    }
  });
});

describe("publication selection", () => {
  it("defaults to the first", () => {
    expect(selectPublication(config()).publicationUrl).toBe("example.substack.com");
  });

  it("matches on a bare name", () => {
    expect(selectPublication(config(), "second").publicationUrl).toBe("second.substack.com");
  });

  it("matches on a full url", () => {
    expect(selectPublication(config(), "https://second.substack.com/").publicationUrl).toBe(
      "second.substack.com",
    );
  });

  it("names what is connected when nothing matches", () => {
    expect(() => selectPublication(config(), "nope")).toThrow(/Connected: example/);
  });

  it("explains how to configure when nothing is connected", () => {
    expect(() => selectPublication(config({ publications: [] }))).toThrow(
      /SUBSTACK_PUBLICATION_URL/,
    );
  });
});

describe("host normalisation", () => {
  it("strips scheme, path and case", () => {
    expect(normalizeHost("HTTPS://Example.Substack.com/p/post")).toBe("example.substack.com");
    expect(normalizeHost("example.substack.com/")).toBe("example.substack.com");
  });
});
