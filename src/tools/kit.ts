/**
 * Shared plumbing every tool uses.
 *
 * Registering 63 tools by hand means 63 chances to forget an annotation, drop
 * an error into a stack trace, or return a shape the model cannot read. This
 * wraps all of it once so a tool module only describes what it actually does.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { SubstackClient } from "../api/client.js";
import { SubstackError } from "../api/errors.js";
import type { Config, Credentials } from "../config.js";
import { selectPublication } from "../config.js";
import { annotationsFor, type Risk, type WriteGuard } from "../safety.js";

export type ToolContext = {
  client: SubstackClient;
  config: Config;
  guard: WriteGuard;
  /** Resolve which publication this call targets. */
  publication: (hint?: string) => Credentials;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Every tool returns pretty JSON, so a model can read it without guessing. */
export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Errors come back as a normal result with `isError`, not a thrown exception.
 *
 * A thrown MCP error reaches the model as a protocol failure with no structure.
 * A result it can read tells it what went wrong and often how to fix it, which
 * is the difference between the model retrying correctly and giving up.
 */
export function fail(error: unknown): ToolResult {
  const payload =
    error instanceof SubstackError
      ? error.toJSON()
      : { error: (error as Error)?.message ?? String(error) };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

/** The optional argument that picks a publication, on every publication-scoped tool. */
export const publicationArg = {
  publication: z
    .string()
    .optional()
    .describe(
      "Which connected publication to act on, matched loosely against its hostname (for example 'example.substack.com' or just 'example'). Defaults to the first connected publication.",
    ),
};

/** The confirmation argument required by every irreversible tool. */
export const confirmArg = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Must be true for this to run. This action cannot be undone, so it is refused without an explicit confirmation.",
    ),
};

export type ToolSpec<S extends ZodRawShape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  /** True when the effect is visible to anyone but you. */
  public?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log, when this is a write. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export function defineTool<S extends ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/**
 * A tool of any shape, for the one place tools are held together in a list.
 *
 * `ToolSpec` is generic over its schema, so a list of tools with different
 * schemas has no single type: each handler accepts a different argument shape,
 * and function parameters are contravariant. The type safety that matters lives
 * inside each `defineTool` call, where the schema and the handler are checked
 * against each other. This only loosens the seam where they are collected.
 *
 * The handler's parameter is erased to `never` rather than widened to `any`:
 * `never` is assignable to every argument type, so any concrete handler fits,
 * whereas a widened object type fails contravariance and rejects all of them.
 */
export type AnyToolSpec = Omit<ToolSpec<ZodRawShape>, "handler" | "summary"> & {
  handler: (args: never, ctx: ToolContext) => Promise<unknown>;
  summary?: (args: never) => string;
};

/** Register one tool against the server, with guarding and error handling applied. */
export function register(
  server: McpServer,
  ctx: ToolContext,
  spec: AnyToolSpec,
): void {
  // A read-only server should not advertise writes it will refuse.
  if (ctx.guard.readOnly && spec.risk !== "read") return;

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema,
      annotations: {
        title: spec.title,
        ...annotationsFor(spec.risk, { public: spec.public }),
      },
    },
    // The SDK derives its callback type from the schema generic. This wrapper is
    // generic over the same shape, but TypeScript cannot prove the two are equal
    // through the indirection, so the cast lives at this single boundary instead
    // of in all 63 tool definitions.
    (async (args: Record<string, unknown>) => {
      try {
        if (spec.risk !== "read") {
          const summary = spec.summary?.(args as never) ?? spec.name;
          const confirm = (args as { confirm?: boolean }).confirm;
          ctx.guard.check(spec.name, spec.risk, confirm, summary);
        }
        return ok(await spec.handler(args as never, ctx));
      } catch (error) {
        return fail(error);
      }
    }) as never,
  );
}

export function makeContext(
  client: SubstackClient,
  config: Config,
  guard: WriteGuard,
): ToolContext {
  return {
    client,
    config,
    guard,
    publication: (hint?: string) => selectPublication(config, hint),
  };
}

/** Clamp a caller-supplied limit into a range Substack will accept. */
export function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Build a query string, dropping undefined values. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
