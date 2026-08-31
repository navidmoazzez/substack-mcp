/**
 * Decides whether a write is allowed to reach Substack.
 *
 * The reference implementations take opposite positions and neither is right.
 * One ships publish and delete unguarded. The other removes them and calls that
 * safety, which just moves the work back to the human without making anything
 * safer.
 *
 * The real hazard is specific and worth naming. `publish_draft` with `send:true`
 * emails every subscriber you have, and there is no unsend. `delete_draft` has
 * no undo. Both are one plausible mis-parse away from a model that was asked to
 * "clean up my drafts". Neither is dangerous when a human meant it.
 *
 * So: everything works, and the irreversible operations need an explicit
 * `confirm: true` argument the model has to set deliberately after reading the
 * tool description. That is a speed bump a careless call trips over and an
 * intentional one clears in a single retry.
 *
 * SUBSTACK_READ_ONLY=1 turns off every write for people pointing an untrusted
 * agent at their publication.
 */

import { appendFileSync } from "node:fs";
import type { Config } from "./config.js";
import { WriteBlockedError } from "./api/errors.js";

/** How risky an operation is, which drives both guarding and MCP annotations. */
export type Risk =
  /** Reads nothing but public or own data. */
  | "read"
  /** Creates or updates something private and reversible. */
  | "write"
  /** Irreversible, or visible to other people the moment it runs. */
  | "destructive";

export class WriteGuard {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  get readOnly(): boolean {
    return this.config.readOnly;
  }

  /**
   * Throws unless this operation is allowed to proceed.
   *
   * @param tool     the tool name, for the message and the audit log
   * @param risk     how dangerous the operation is
   * @param confirm  the caller's explicit confirmation, for destructive ops
   * @param summary  what is about to happen, in one line, for the audit log
   */
  check(tool: string, risk: Risk, confirm: boolean | undefined, summary: string): void {
    if (risk === "read") return;

    if (this.config.readOnly) {
      this.audit(tool, summary, "blocked: read-only");
      throw new WriteBlockedError(
        `${tool} is a write and this server is running with SUBSTACK_READ_ONLY=1. Unset it to allow writes.`,
      );
    }

    if (risk === "destructive") {
      if (!this.config.allowDestructive) {
        this.audit(tool, summary, "blocked: destructive disabled");
        throw new WriteBlockedError(
          `${tool} is irreversible and SUBSTACK_ALLOW_DESTRUCTIVE is off on this server.`,
        );
      }
      if (confirm !== true) {
        this.audit(tool, summary, "blocked: unconfirmed");
        throw new WriteBlockedError(
          `${tool} is irreversible: ${summary}. Nothing has been changed. Re-run with confirm: true if that is what you want.`,
        );
      }
    }

    this.audit(tool, summary, "allowed");
  }

  /** Append-only record of every write that was attempted, allowed or not. */
  private audit(tool: string, summary: string, outcome: string): void {
    if (!this.config.auditPath) return;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      tool,
      summary,
      outcome,
    });
    try {
      appendFileSync(this.config.auditPath, `${line}\n`, { mode: 0o600 });
    } catch {
      // An unwritable audit log must never break a tool call.
    }
  }
}

/**
 * MCP tool annotations for a risk level.
 *
 * Set explicitly on every tool, because MCP defaults `destructiveHint` and
 * `openWorldHint` to true when omitted. A read tool left unannotated therefore
 * shows up in a client as destructive, which trains people to ignore the
 * warnings that matter.
 */
export function annotationsFor(
  risk: Risk,
  opts: { public?: boolean } = {},
): { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } {
  return {
    readOnlyHint: risk === "read",
    destructiveHint: risk === "destructive",
    idempotentHint: risk === "read",
    // True when the effect is visible outside your own private drafts.
    openWorldHint: opts.public ?? risk === "destructive",
  };
}
