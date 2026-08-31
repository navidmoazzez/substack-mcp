/**
 * Published posts: listing, reading and per-post performance.
 */

import { z } from "zod";
import { draftBodyToMarkdown } from "../content/body.js";
import { clamp, defineTool, publicationArg, query } from "./kit.js";

export const postTools = [
  defineTool({
    name: "list_posts",
    title: "List published posts",
    risk: "read",
    description: "List published posts, newest first.",
    schema: {
      limit: z.number().optional().describe("How many to return. 1 to 100, default 25."),
      offset: z.number().optional().describe("Skip this many, for paging."),
      order_by: z.enum(["post_date", "title"]).optional().default("post_date"),
      order_direction: z.enum(["asc", "desc"]).optional().default("desc"),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 25, 100);
      const data = await ctx.client.request<{ posts?: unknown[]; total?: number }>(
        `${ctx.client.apiUrl(creds)}/post_management/published` +
          query({
            offset: args.offset ?? 0,
            limit,
            order_by: args.order_by ?? "post_date",
            order_direction: args.order_direction ?? "desc",
          }),
        { creds },
      );
      const posts = Array.isArray(data.posts) ? data.posts : [];
      return {
        total: data.total ?? posts.length,
        returned: posts.length,
        limit,
        offset: args.offset ?? 0,
        posts: posts.map((p) => {
          const post = p as Record<string, unknown>;
          return {
            id: post.id,
            title: post.title,
            subtitle: post.subtitle,
            slug: post.slug,
            url: post.canonical_url,
            post_date: post.post_date,
            audience: post.audience,
            type: post.type,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "get_post",
    title: "Read a published post",
    risk: "read",
    description:
      "Read a published post in full by its slug. Works on any public Substack, not just your own, so it doubles as a way to read a competitor's post.",
    schema: {
      slug: z.string().describe("The post slug, which is the last part of its URL after /p/."),
      publication_url: z
        .string()
        .optional()
        .describe(
          "Which publication to read from, for example 'example.substack.com'. Defaults to your own.",
        ),
      body_format: z
        .enum(["markdown", "html", "both"])
        .optional()
        .default("markdown")
        .describe("How to return the body."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const host = args.publication_url
        ? args.publication_url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
        : ctx.publication(args.publication).publicationUrl;

      const post = await ctx.client.request<Record<string, unknown>>(
        `https://${host}/api/v1/posts/${encodeURIComponent(args.slug)}`,
        { authenticated: false },
      );

      const format = args.body_format ?? "markdown";
      const result: Record<string, unknown> = {
        id: post.id,
        title: post.title,
        subtitle: post.subtitle,
        slug: post.slug,
        url: post.canonical_url,
        post_date: post.post_date,
        audience: post.audience,
        author: post.publishedBylines,
        cover_image: post.cover_image ?? null,
        word_count: post.wordcount ?? null,
        reactions: post.reactions ?? {},
        comment_count: post.comment_count ?? 0,
        is_paywalled: post.audience !== "everyone",
      };

      if (format === "html" || format === "both") result.body_html = post.body_html ?? null;
      if (format === "markdown" || format === "both") {
        result.body_markdown = post.body_html
          ? draftBodyToMarkdown(post.body_html)
          : draftBodyToMarkdown(post.draft_body);
      }
      return result;
    },
  }),

  defineTool({
    name: "get_post_by_id",
    title: "Read a post by id",
    risk: "read",
    description:
      "Read a published post by its numeric id rather than its slug. Use this when a stats or list tool gave you an id.",
    schema: {
      post_id: z.number().describe("Numeric post id."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const post = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/posts/by-id/${args.post_id}`,
        { creds },
      );
      return post;
    },
  }),

  defineTool({
    name: "search_posts",
    title: "Search your posts",
    risk: "read",
    description: "Search your own published posts by keyword, across title and body.",
    schema: {
      query: z.string().describe("What to search for."),
      limit: z.number().optional().describe("How many to return. 1 to 50, default 20."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 20, 50);
      const data = await ctx.client.request<{ results?: unknown[]; posts?: unknown[] }>(
        `${ctx.client.apiUrl(creds)}/post_search` + query({ query: args.query, limit }),
        { creds },
      );
      const results = (Array.isArray(data.results) ? data.results : data.posts) ?? [];
      return {
        query: args.query,
        count: results.length,
        posts: (results as Record<string, unknown>[]).map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          url: post.canonical_url,
          post_date: post.post_date,
        })),
      };
    },
  }),

  defineTool({
    name: "get_post_stats",
    title: "Get one post's stats",
    risk: "read",
    description:
      "Full performance detail for one published post: opens, clicks, views, signups driven, reactions, restacks and comments.",
    schema: {
      post_id: z.number().describe("Numeric post id."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/post_management/detail/${args.post_id}`,
        { creds },
      );
      return data;
    },
  }),

  defineTool({
    name: "rank_posts",
    title: "Rank your posts by a metric",
    risk: "read",
    description:
      "Rank published posts by a performance metric, to find what actually worked. Sort by open rate, click rate, views, signups, paid conversions, reactions, restacks or comments.",
    schema: {
      order_by: z
        .string()
        .optional()
        .default("post_date")
        .describe(
          "Metric to rank by. Common values: post_date, views, opens, open_rate, clicks, click_rate, signups, paid_signups, reactions, restacks, comments.",
        ),
      order_direction: z.enum(["asc", "desc"]).optional().default("desc"),
      limit: z.number().optional().describe("How many to return. 1 to 100, default 25."),
      offset: z.number().optional(),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 25, 100);
      const data = await ctx.client.request<{ posts?: unknown[]; total?: number }>(
        `${ctx.client.apiUrl(creds)}/post_management/published` +
          query({
            offset: args.offset ?? 0,
            limit,
            order_by: args.order_by ?? "post_date",
            order_direction: args.order_direction ?? "desc",
          }),
        { creds },
      );
      const posts = Array.isArray(data.posts) ? data.posts : [];
      return {
        ranked_by: args.order_by ?? "post_date",
        direction: args.order_direction ?? "desc",
        total: data.total ?? posts.length,
        posts,
      };
    },
  }),
];
