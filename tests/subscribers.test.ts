import { describe, expect, it } from "vitest";
import { buildQuery, EXPORTABLE_COLUMNS, COLUMN_NAMES } from "../src/subscribers/columns.js";
import { parseCsv } from "../src/tools/subscribers.js";
import { errorForStatus, extractErrorDetail } from "../src/api/errors.js";
import { isPrivateAddress, detectMimeType } from "../src/content/image.js";

describe("subscriber filters", () => {
  it("covers all 48 columns", () => {
    expect(COLUMN_NAMES).toHaveLength(48);
  });

  it("maps an intent onto the suffix the API wants", () => {
    const q = buildQuery({ filters: [{ column: "num_comments", operator: "gt", value: 5 }] });
    expect(q.filters).toEqual({ num_comments_gt: 5 });
  });

  it("sends a bare column name where the suffix is empty", () => {
    const q = buildQuery({ filters: [{ column: "is_subscribed", operator: "is", value: 1 }] });
    expect(q.filters).toEqual({ is_subscribed: 1 });
  });

  it("uses the right suffix for a string contains", () => {
    const q = buildQuery({
      filters: [{ column: "user_email_address", operator: "contains", value: "gmail" }],
    });
    expect(q.filters).toEqual({ user_email_address_similar_to: "gmail" });
  });

  it("refuses an operator that does not apply to the column's type", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "user_name", operator: "gt", value: 3 }] }),
    ).toThrow(/does not apply/);
  });

  it("names the valid operators when it refuses", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "user_name", operator: "gt", value: 3 }] }),
    ).toThrow(/contains/);
  });

  it("refuses an unknown column", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "nope", operator: "is", value: 1 }] }),
    ).toThrow(/Unknown subscriber column/);
  });

  it("refuses a scalar where a list is required", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "tag_ids", operator: "includes_any", value: 7 }] }),
    ).toThrow(/takes a list/);
  });

  it("refuses a list where a scalar is required", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "num_comments", operator: "gt", value: [1, 2] }] }),
    ).toThrow(/takes a single value/);
  });

  it("validates enum values", () => {
    expect(() =>
      buildQuery({ filters: [{ column: "subscription_type", operator: "is", value: "platinum" }] }),
    ).toThrow(/not a valid value/);
  });

  it("refuses two conditions that would collapse into one key", () => {
    expect(() =>
      buildQuery({
        filters: [
          { column: "num_comments", operator: "gt", value: 1 },
          { column: "num_comments", operator: "gt", value: 5 },
        ],
      }),
    ).toThrow(/Duplicate filter/);
  });

  it("allows two different operators on the same column", () => {
    const q = buildQuery({
      filters: [
        { column: "num_comments", operator: "gt", value: 1 },
        { column: "num_comments", operator: "lt", value: 10 },
      ],
    });
    expect(q.filters).toEqual({ num_comments_gt: 1, num_comments_lt: 10 });
  });

  it("puts search inside filters, where the API actually reads it", () => {
    const q = buildQuery({ search: "ada" });
    expect(q.filters).toEqual({ search: "ada" });
  });

  it("uses the nulls-last key when sorting descending", () => {
    expect(buildQuery({ sortBy: "num_comments", sortDirection: "desc" }).filters).toEqual({
      order_by_desc_nulls_last: "num_comments",
    });
    expect(buildQuery({ sortBy: "num_comments", sortDirection: "asc" }).filters).toEqual({
      order_by: "num_comments",
    });
  });

  it("rejects a date that does not parse", () => {
    expect(() =>
      buildQuery({
        filters: [{ column: "subscription_created_at", operator: "is_before", value: "last tuesday" }],
      }),
    ).toThrow(/needs a date/);
  });

  it("excludes the two columns Substack silently drops from exports", () => {
    expect(EXPORTABLE_COLUMNS).not.toContain("tag_ids");
    expect(EXPORTABLE_COLUMNS).not.toContain("group_membership");
    expect(EXPORTABLE_COLUMNS).toHaveLength(46);
  });
});

describe("csv parsing", () => {
  it("handles quoted fields with commas", () => {
    expect(parseCsv('a,b\n"one, two",three')).toEqual([
      ["a", "b"],
      ["one, two", "three"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('x\n"say ""hi"""')).toEqual([["x"], ['say "hi"']]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([["a"], ["line one\nline two"]]);
  });
});

describe("error mapping", () => {
  it("maps 401 to an authentication error naming the fix", () => {
    const err = errorForStatus(401, "/api/v1/drafts", "");
    expect(err.name).toBe("AuthenticationError");
    expect(err.message).toMatch(/expired/);
  });

  it("recognises a Cloudflare block hiding behind a 403", () => {
    const err = errorForStatus(403, "/api/v1/drafts", "error code: 1010");
    expect(err.message).toMatch(/canonical/);
  });

  it("maps the rest of the statuses", () => {
    expect(errorForStatus(429, "/x", "").name).toBe("RateLimitError");
    expect(errorForStatus(400, "/x", "").name).toBe("ValidationError");
    expect(errorForStatus(404, "/x", "").name).toBe("NotFoundError");
    expect(errorForStatus(503, "/x", "").name).toBe("ServerError");
  });

  it("pulls a message out of every body shape", () => {
    expect(extractErrorDetail('{"error":"nope"}')).toBe("nope");
    expect(extractErrorDetail('{"errors":["a","b"]}')).toBe("a; b");
    expect(extractErrorDetail("plain text")).toBe("plain text");
  });

  it("caps a huge html block page rather than making it the whole message", () => {
    expect(extractErrorDetail("<html>" + "x".repeat(5000)).length).toBeLessThanOrEqual(500);
  });
});

describe("image upload guards", () => {
  it("refuses the addresses that make this an SSRF proxy", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("refuses an ipv4-mapped ipv6 address hiding a private target", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows a public address", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("detects a type from content rather than trusting an extension", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectMimeType(png)).toBe("image/png");
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectMimeType(Buffer.from("not an image"))).toBeNull();
  });
});
