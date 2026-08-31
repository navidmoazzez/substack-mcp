/**
 * Analytics.
 *
 * The dashboard's Stats tabs are each a separate endpoint with its own
 * parameter conventions: some want a YYYY-MM-DD window, one wants full ISO
 * timestamps, several answer 400 without a limit. Rather than 16 tools, this is
 * one tool with a report name, and the differences are handled here.
 */

import { z } from "zod";
import { clamp, defineTool, publicationArg, query } from "./kit.js";

type WindowKind = "date" | "iso" | "none";

type Report = {
  path: string;
  window?: WindowKind;
  params?: Record<string, string | number | boolean>;
  limit?: number;
  description: string;
};

export const ANALYTICS_REPORTS: Record<string, Report> = {
  unsubscribes: {
    path: "/publication/stats/unsubscribes",
    window: "date",
    description: "Unsubscribes in a window, broken down by the reason given.",
  },
  unsubscribes_timeseries: {
    path: "/publication/stats/unsubscribes/timeseries",
    window: "date",
    description: "Unsubscribes over time.",
  },
  retention: {
    path: "/publication/stats/subscriber_retention",
    window: "iso",
    params: { months: 12, is_subscribed: false },
    description:
      "Cohort retention: how much of each signup cohort is still subscribed months later.",
  },
  retention_summary: {
    path: "/publication/stats/subscriber_retention/summary",
    params: { is_subscribed: false },
    description: "Headline retention rates at 1, 6 and 12 months.",
  },
  referrals_leaderboard: {
    path: "/publication/stats/referrals/leaderboard",
    description: "Which subscribers have referred the most readers.",
  },
  referrals_summary: {
    path: "/publication/stats/referrals/summary",
    description: "Gifts sent, accepted and converted.",
  },
  audience_overlap: {
    path: "/publication/stats/audience_insights/overlap",
    limit: 6,
    description:
      "Other Substacks whose audience overlaps yours, with the overlap percentage. The publications worth collaborating with.",
  },
  audience_locations: {
    path: "/publication/stats/audience_insights/location/total",
    description: "How many distinct countries and US states your subscribers span.",
  },
  subscriber_notes: {
    path: "/publication/stats/subscriber_notes",
    limit: 8,
    description: "Recent Notes written by your subscribers.",
  },
  paid_subscriber_growth: {
    path: "/publication/stats/paid_subscriber_growth/summary",
    description: "Paid growth for the period, with new subscriptions and expirations.",
  },
  arr_timeseries: {
    path: "/publication/stats/arr/timeseries",
    description: "Annual recurring revenue over time.",
  },
  followers_timeseries: {
    path: "/publication/stats/followers/timeseries",
    description: "Follower count over time.",
  },
  subscribers_timeseries: {
    path: "/publication/stats/subscribers/timeseries",
    params: { period: "month" },
    description: "Subscriber count over time.",
  },
  growth_sources: {
    path: "/publication/stats/growth/sources",
    window: "date",
    params: { order_by: "users", order_direction: "desc" },
    description:
      "Where new subscribers came from in a window, ranked by how many each source brought.",
  },
  growth_events: {
    path: "/publication/stats/growth/events",
    window: "date",
    description: "The individual growth events in a window.",
  },
  network_attribution: {
    path: "/publication/stats/network_attribution",
    params: { time_window: "90 days", is_subscribed: false },
    description:
      "What share of your subscribers arrived through the Substack network rather than your own channels.",
  },
};

const REPORT_NAMES = Object.keys(ANALYTICS_REPORTS) as [string, ...string[]];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 30;

const asDate = (d: Date): string => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, days: number): Date => new Date(d.getTime() - days * 86_400_000);

function yearBefore(date: Date): Date {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
  return shifted;
}

export const analyticsTools = [
  defineTool({
    name: "get_analytics",
    title: "Read an analytics report",
    risk: "read",
    description: `Read one of the publication-level reports behind the dashboard's Stats tabs.

Reports:
${Object.entries(ANALYTICS_REPORTS)
  .map(([name, r]) => `- ${name}: ${r.description}`)
  .join("\n")}

Reports covering a period default to the last 30 days, or the last year for retention.`,
    schema: {
      report: z.enum(REPORT_NAMES).describe("Which report to read."),
      from_date: z
        .string()
        .regex(DATE_PATTERN, "from_date must be YYYY-MM-DD")
        .optional()
        .describe("Start of the window, YYYY-MM-DD. Only used by reports covering a period."),
      to_date: z
        .string()
        .regex(DATE_PATTERN, "to_date must be YYYY-MM-DD")
        .optional()
        .describe("End of the window, YYYY-MM-DD."),
      limit: z.number().optional().describe("Row cap, for the reports that take one."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const report = ANALYTICS_REPORTS[args.report];
      if (!report) {
        throw new Error(
          `Unknown report "${args.report}". Valid reports: ${REPORT_NAMES.join(", ")}`,
        );
      }

      const now = new Date();
      const params: Record<string, string | number | boolean | undefined> = {
        ...(report.params ?? {}),
      };

      if (report.window === "date") {
        params.from_date = args.from_date ?? asDate(daysBefore(now, DEFAULT_WINDOW_DAYS));
        params.to_date = args.to_date ?? asDate(now);
      } else if (report.window === "iso") {
        params.start = args.from_date
          ? new Date(args.from_date).toISOString()
          : yearBefore(now).toISOString();
        params.end = args.to_date ? new Date(args.to_date).toISOString() : now.toISOString();
      }

      if (args.limit !== undefined) params.limit = args.limit;
      else if (report.limit !== undefined) params.limit = report.limit;

      const data = await ctx.client.request<unknown>(
        `${ctx.client.apiUrl(creds)}${report.path}${query(params)}`,
        { creds },
      );

      return {
        report: args.report,
        description: report.description,
        window:
          report.window === "none" || report.window === undefined
            ? null
            : { from: params.from_date ?? params.start, to: params.to_date ?? params.end },
        data,
      };
    },
  }),

  defineTool({
    name: "get_dashboard_summary",
    title: "Get the dashboard summary",
    risk: "read",
    description:
      "The headline numbers from the publishing dashboard: subscribers at the start and end of the window, paid subscribers, ARR and recent activity. The best single call for 'how is my newsletter doing'.",
    schema: {
      range_days: z
        .number()
        .optional()
        .describe("Window in days, for example 7, 30 or 90. Defaults to 30."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      // Verified against the live API: this endpoint answers 400 without a
      // `range`, and only accepts a plain integer number of days.
      return ctx.client.request(
        `${ctx.client.apiUrl(creds)}/publish-dashboard/summary-v2` +
          query({ range: clamp(args.range_days, 30, 3650) }),
        { creds },
      );
    },
  }),

  defineTool({
    name: "get_email_stats",
    title: "Get email performance",
    risk: "read",
    description:
      "Overall email performance: delivery, open rate and click rate across the publication.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      return ctx.client.request(
        `${ctx.client.apiUrl(creds)}/publication/stats/email_stats`,
        { creds },
      );
    },
  }),

  defineTool({
    name: "get_growth_sources",
    title: "Get subscriber growth sources",
    risk: "read",
    description:
      "Where new subscribers came from in a window, ranked by how many each source brought. Same data as get_analytics with the growth_sources report, kept as its own tool because it answers one of the most common questions directly.",
    schema: {
      from_date: z
        .string()
        .regex(DATE_PATTERN, "from_date must be YYYY-MM-DD")
        .optional()
        .describe("Start of the window, YYYY-MM-DD. Defaults to 30 days ago."),
      to_date: z
        .string()
        .regex(DATE_PATTERN, "to_date must be YYYY-MM-DD")
        .optional()
        .describe("End of the window, YYYY-MM-DD. Defaults to today."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const now = new Date();
      return ctx.client.request(
        `${ctx.client.apiUrl(creds)}/publication/stats/growth/sources` +
          query({
            from_date: args.from_date ?? asDate(daysBefore(now, DEFAULT_WINDOW_DAYS)),
            to_date: args.to_date ?? asDate(now),
            order_by: "users",
            order_direction: "desc",
          }),
        { creds },
      );
    },
  }),

  defineTool({
    name: "get_revenue_summary",
    title: "Get revenue summary",
    risk: "read",
    description:
      "Revenue and subscription plans: what each tier costs, how many are on it, and what it brings in.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      return ctx.client.request(`${ctx.client.apiUrl(creds)}/pledges/plans/summary`, { creds });
    },
  }),
];
