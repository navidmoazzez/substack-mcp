/**
 * Subscribers: listing, filtering, exporting and adding.
 *
 * Two tools cover reading the list because Substack splits the capability in an
 * awkward place. `list_subscribers` can filter on every engagement column but
 * returns only the columns saved in the publication's Display settings, and it
 * ignores a per-request column list. So the values you filtered on often are
 * not in what comes back. `export_subscribers` is the way to actually read them.
 */

import { z } from "zod";
import {
  buildQuery,
  columnReference,
  COLUMN_NAMES,
  EXPORTABLE_COLUMNS,
  LIST_OPERATORS,
  OPERATORS_BY_TYPE,
  type Filter,
  type Operator,
} from "../subscribers/columns.js";
import { clamp, defineTool, publicationArg, query } from "./kit.js";

const OPERATOR_NAMES = [
  ...new Set(Object.values(OPERATORS_BY_TYPE).flatMap((ops) => Object.keys(ops))),
] as [string, ...string[]];

const filterSchema = z.object({
  column: z.string().describe("Which column to filter on."),
  operator: z
    .enum(OPERATOR_NAMES)
    .describe("How to compare. Which operators apply depends on the column's type."),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .describe(
      `A single value, or a list for ${[...LIST_OPERATORS].join(", ")}.`,
    ),
});

const filterDescription = `Conditions, combined with AND. There is no OR and no nesting: anything needing OR has to be issued as separate calls.

Operators by column type:
- Int: is, is_not, gt, gte, lt, lte
- String: is, is_not, is_any_of, contains, starts_with, ends_with, includes_none
- DateTime: is_on, is_after, is_on_or_after, is_before, is_on_or_before
- Array (tag_ids, emails_enabled): includes_any, includes_all, includes_none
- subscription_type and group_membership: is, is_not, is_any_of

Columns: ${columnReference()}`;

export const subscriberTools = [
  defineTool({
    name: "list_subscribers",
    title: "List and filter subscribers",
    risk: "read",
    description: `List subscribers, with the same filtering the Subscribers dashboard offers: 48 columns, free-text search, sorting and paging.

Returns {count, returned, limit, offset, subscribers}. count is the total matching the filters regardless of limit, so calling with limit: 1 is a cheap way to size a segment before pulling it.

Note: Substack takes the fields it returns from the publication's saved Display settings and ignores a per-request column list. Engagement columns can be filtered on here but are usually not present in the records that come back. Use export_subscribers to read their values.`,
    schema: {
      filters: z.array(filterSchema).optional().describe(filterDescription),
      search: z
        .string()
        .optional()
        .describe("Free text matched against subscriber name and email."),
      sort_by: z.string().optional().describe("Any column name to sort by."),
      sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
      limit: z.number().optional().describe("How many to return. 1 to 100, default 25."),
      offset: z.number().optional().describe("Skip this many, for paging."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 25, 100);

      const query = buildQuery({
        filters: args.filters as Filter[] | undefined,
        search: args.search,
        sortBy: args.sort_by,
        sortDirection: args.sort_direction ?? "desc",
        limit,
        offset: args.offset ?? 0,
      });

      const data = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/subscriber-stats`,
        { method: "POST", body: query, creds },
      );

      const rows = (Array.isArray(data.subscribers) ? data.subscribers : []) as unknown[];
      return {
        count: data.total ?? data.count ?? rows.length,
        returned: rows.length,
        limit,
        offset: args.offset ?? 0,
        subscribers: rows,
      };
    },
  }),

  defineTool({
    name: "export_subscribers",
    title: "Export subscribers with every column",
    risk: "read",
    description: `Export subscribers as full records, which is the only way to actually read the engagement metrics list_subscribers can only filter on: opens over 7d/30d/6mo, unique emails seen, post views, comments, shares, links clicked, days active and activity rating.

Substack builds the file asynchronously, so this creates a subscriber set, requests the export, polls until it is ready and downloads it. A small export takes a few seconds.

Two things verified against the live API and worth knowing:
- tag_ids and group_membership cannot be exported. Substack drops them without failing, so they come back in missing_columns. Asking for all 48 returns 46.
- Values arrive display-formatted, not raw. Revenue is "$50.00" here and the number 50 through list_subscribers. Dates are ISO strings.

There is no paging: an export covers the whole matching set.`,
    schema: {
      filters: z.array(filterSchema).optional().describe(filterDescription),
      search: z.string().optional().describe("Free text matched against name and email."),
      columns: z
        .array(z.string())
        .optional()
        .describe(`Which columns to include. Defaults to all exportable ones: ${EXPORTABLE_COLUMNS.join(", ")}`),
      max_wait_seconds: z
        .number()
        .optional()
        .describe("How long to wait for the file. 1 to 600, default 120."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const api = ctx.client.apiUrl(creds);
      const maxWait = clamp(args.max_wait_seconds, 120, 600);

      const requested = args.columns ?? EXPORTABLE_COLUMNS;
      const unknown = requested.filter((c) => !COLUMN_NAMES.includes(c));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown column(s): ${unknown.join(", ")}. Valid columns: ${COLUMN_NAMES.join(", ")}`,
        );
      }
      const columns = requested.filter((c) => EXPORTABLE_COLUMNS.includes(c));
      const missing = requested.filter((c) => !EXPORTABLE_COLUMNS.includes(c));

      const query = buildQuery({
        filters: args.filters as Filter[] | undefined,
        search: args.search,
        limit: 1,
        offset: 0,
      });

      const set = await ctx.client.request<{ id?: number; subscriber_set_id?: number }>(
        `${api}/subscriber_set`,
        { method: "POST", body: { query }, creds },
      );
      const setId = set.id ?? set.subscriber_set_id;
      if (setId === undefined) {
        throw new Error("Substack did not return a subscriber set id for the export.");
      }

      const started = await ctx.client.request<{ id?: number; export_id?: number }>(
        `${api}/subscriber_set/export`,
        { method: "POST", body: { subscriberSetId: setId, columns }, creds },
      );
      const exportId = started.id ?? started.export_id;
      if (exportId === undefined) {
        throw new Error("Substack did not return an export id.");
      }

      const deadline = Date.now() + maxWait * 1000;
      let csv: string | null = null;

      while (Date.now() < deadline) {
        const status = await ctx.client.request<Record<string, unknown>>(
          `${api}/subscriber_set/export/${exportId}`,
          { creds },
        );

        const url = typeof status.url === "string" ? status.url : null;
        const state = String(status.status ?? status.state ?? "");

        if (url) {
          csv = await ctx.client.request<string>(url, { creds, raw: true });
          break;
        }
        if (/fail|error/i.test(state)) {
          throw new Error(`Substack reported the export as ${state}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (csv === null) {
        return {
          ready: false,
          export_id: exportId,
          waited_seconds: maxWait,
          message: `The export was still building after ${maxWait}s. It keeps running on Substack's side. Call again with a larger max_wait_seconds, or retrieve it from the dashboard.`,
        };
      }

      const rows = parseCsv(csv);
      const header = rows.shift() ?? [];

      return {
        ready: true,
        export_id: exportId,
        count: rows.length,
        columns: header,
        missing_columns: missing,
        subscribers: rows.map((row) =>
          Object.fromEntries(header.map((name, i) => [name, row[i] ?? null])),
        ),
      };
    },
  }),

  defineTool({
    name: "get_subscriber_count",
    title: "Get subscriber counts",
    risk: "read",
    description:
      "Total subscribers, split by free and paid. The fastest way to answer 'how many subscribers do I have'.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const api = ctx.client.apiUrl(creds);

      // There is no subscriber_count endpoint: /publication/stats/subscriber_count
      // answers 404. The dashboard summary is where the numbers actually live,
      // and it needs a `range` in days.
      const summary = await ctx.client.request<Record<string, number>>(
        `${api}/publish-dashboard/summary-v2` + query({ range: 30 }),
        { creds },
      );

      return {
        subscriber_count: summary.totalSubscribersEnd ?? null,
        paid_subscriber_count: summary.paidSubscribersEnd ?? null,
        free_subscriber_count:
          summary.totalSubscribersEnd !== undefined && summary.paidSubscribersEnd !== undefined
            ? summary.totalSubscribersEnd - summary.paidSubscribersEnd
            : null,
        subscribers_30_days_ago: summary.totalSubscribersStart ?? null,
        arr: summary.arrEnd ?? null,
      };
    },
  }),

  defineTool({
    name: "add_subscriber",
    title: "Add a subscriber",
    risk: "write",
    public: true,
    description:
      "Add an email address to your subscriber list. Only add people who asked to be added: importing someone who did not opt in is what gets a publication marked as spam.",
    schema: {
      email: z.string().describe("Email address to add."),
      subscription_type: z
        .enum(["free", "gift_paid"])
        .optional()
        .default("free")
        .describe("Whether to add them as free or as a gifted paid subscriber."),
      ...publicationArg,
    },
    summary: (a) => `add subscriber ${a.email}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const result = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/subscriber/add`,
        {
          method: "POST",
          body: { email: args.email, subscription_type: args.subscription_type ?? "free" },
          creds,
        },
      );
      return { added: true, email: args.email, response: result };
    },
  }),
];

/** A CSV reader that handles quoted fields, embedded commas and escaped quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
