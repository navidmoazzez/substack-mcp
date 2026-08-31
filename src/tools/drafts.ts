/**
 * Drafts: creating, editing, reading back, scheduling and publishing.
 *
 * The body arguments here all run through the content pipeline, so a caller can
 * send markdown, HTML or a ProseMirror document and get a post that renders the
 * way a human-written one does.
 */

import { z } from "zod";
import { bylinesFor } from "../api/identity.js";
import { draftBodyToMarkdown, toDraftBody } from "../content/body.js";
import { MARK_VOCABULARY, NODE_VOCABULARY } from "../content/prosemirror.js";
import {
  clamp,
  confirmArg,
  defineTool,
  publicationArg,
  query,
  type ToolContext,
} from "./kit.js";

const AUDIENCE = z
  .enum(["everyone", "only_free", "only_paid", "founding"])
  .describe(
    "Who can read it. 'everyone' is public, 'only_free' is any subscriber, 'only_paid' and 'founding' are paying tiers.",
  );

const POST_TYPE = z
  .enum(["newsletter", "podcast", "thread"])
  .describe("Post type. 'newsletter' is the normal long-form post.");

const BODY_FORMAT = z
  .enum(["auto", "markdown", "html", "prosemirror"])
  .optional()
  .describe(
    "How to read `body`. 'auto' detects it and is almost always right. Use 'prosemirror' to send a Substack document directly.",
  );

const bodyDescription = `Post body. Markdown by default.

Supported: headings, bold, italic, inline code, strikethrough, links, images, nested lists (any depth, ordered and unordered mixed), fenced code blocks with a language, blockquotes and horizontal rules.

Two things worth knowing:
- A line containing only a YouTube, X, Spotify or Vimeo URL becomes a real embedded player, not a link. Put the URL inside a sentence if you want a plain link.
- Write <paywall> on its own line to mark where the paywall starts. Everything after it is for paying subscribers only. One per post.

Markdown tables have no equivalent in Substack's editor, so they are preserved verbatim in a code block rather than being mangled.`;

async function draftPayload(
  ctx: ToolContext,
  creds: ReturnType<ToolContext["publication"]>,
  args: {
    title?: string;
    subtitle?: string;
    body?: string;
    body_format?: "auto" | "markdown" | "html" | "prosemirror";
    section_id?: number;
    audience?: string;
    type?: string;
    cover_image?: string;
    search_engine_title?: string;
    search_engine_description?: string;
    social_title?: string;
  },
  { includeBylines }: { includeBylines: boolean },
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  if (args.title !== undefined) payload.draft_title = args.title;
  if (args.subtitle !== undefined) payload.draft_subtitle = args.subtitle;
  if (args.body !== undefined) {
    payload.draft_body = toDraftBody(args.body, args.body_format ?? "auto");
  }
  if (args.section_id !== undefined) payload.draft_section_id = args.section_id;
  if (args.audience !== undefined) payload.audience = args.audience;
  if (args.type !== undefined) payload.type = args.type;
  if (args.cover_image !== undefined) payload.cover_image = args.cover_image;
  if (args.search_engine_title !== undefined) {
    payload.search_engine_title = args.search_engine_title;
  }
  if (args.search_engine_description !== undefined) {
    payload.search_engine_description = args.search_engine_description;
  }
  if (args.social_title !== undefined) payload.social_title = args.social_title;

  if (includeBylines) {
    // Substack rejects a draft with no byline.
    const bylines = await bylinesFor(ctx.client, creds);
    if (bylines) payload.draft_bylines = bylines;
  }

  return payload;
}

export const draftTools = [
  defineTool({
    name: "create_draft",
    title: "Create a draft",
    risk: "write",
    description:
      "Create a new draft post. The draft is private until you publish it. Returns the draft id, which every other draft tool takes.",
    schema: {
      title: z.string().describe("Post title. This is the headline, not an H1 in the body."),
      subtitle: z.string().optional().describe("Optional subtitle, shown under the title."),
      body: z.string().optional().describe(bodyDescription),
      body_format: BODY_FORMAT,
      section_id: z
        .number()
        .optional()
        .describe("Publish under a section. Call get_sections to find the id."),
      audience: AUDIENCE.optional().default("everyone"),
      type: POST_TYPE.optional().default("newsletter"),
      cover_image: z
        .string()
        .optional()
        .describe("Cover image URL. Use upload_image first to get one hosted on Substack."),
      search_engine_title: z.string().optional().describe("SEO title, if different from the title."),
      search_engine_description: z.string().optional().describe("SEO meta description."),
      social_title: z.string().optional().describe("Title used on social cards."),
      ...publicationArg,
    },
    summary: (a) => `create draft "${a.title}"`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const payload = await draftPayload(ctx, creds, args, { includeBylines: true });
      payload.audience ??= "everyone";
      payload.type ??= "newsletter";
      if (payload.draft_body === undefined) payload.draft_body = toDraftBody("");

      const draft = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/drafts`,
        { method: "POST", body: payload, creds },
      );

      return {
        id: draft.id,
        title: draft.draft_title,
        is_published: draft.is_published ?? false,
        edit_url: `${ctx.client.baseUrl(creds)}/publish/post/${String(draft.id)}`,
        publication: creds.publicationUrl,
      };
    },
  }),

  defineTool({
    name: "update_draft",
    title: "Update a draft",
    risk: "write",
    description:
      "Change any part of an existing draft. Only the fields you pass are touched, so you can update just the title without resending the body. Works on unpublished drafts.",
    schema: {
      id: z.number().describe("Draft id, from create_draft or list_drafts."),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      body: z.string().optional().describe(bodyDescription),
      body_format: BODY_FORMAT,
      section_id: z.number().optional(),
      audience: AUDIENCE.optional(),
      type: POST_TYPE.optional(),
      cover_image: z.string().optional(),
      search_engine_title: z.string().optional(),
      search_engine_description: z.string().optional(),
      social_title: z.string().optional(),
      ...publicationArg,
    },
    summary: (a) => `update draft ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const payload = await draftPayload(ctx, creds, args, { includeBylines: false });
      if (Object.keys(payload).length === 0) {
        throw new Error("Nothing to update. Pass at least one field to change.");
      }

      const draft = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/drafts/${args.id}`,
        { method: "PUT", body: payload, creds },
      );

      return {
        id: draft.id,
        title: draft.draft_title,
        updated_fields: Object.keys(payload),
        edit_url: `${ctx.client.baseUrl(creds)}/publish/post/${String(args.id)}`,
      };
    },
  }),

  defineTool({
    name: "get_draft",
    title: "Read a draft",
    risk: "read",
    description:
      "Read one draft in full. The body comes back as markdown by default, so you can edit a sentence and send it straight back to update_draft. Ask for prosemirror if you need the raw document.",
    schema: {
      id: z.number().describe("Draft id."),
      body_format: z
        .enum(["markdown", "prosemirror", "both"])
        .optional()
        .default("markdown")
        .describe("How to return the body. 'markdown' is editable, 'prosemirror' is exact."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const draft = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/drafts/${args.id}`,
        { creds },
      );

      const format = args.body_format ?? "markdown";
      const result: Record<string, unknown> = {
        id: draft.id,
        title: draft.draft_title,
        subtitle: draft.draft_subtitle,
        audience: draft.audience,
        type: draft.type,
        section_id: draft.draft_section_id,
        is_published: draft.is_published ?? false,
        scheduled_for: draft.draft_publish_at ?? null,
        cover_image: draft.cover_image ?? null,
        word_count: draft.word_count ?? null,
        updated_at: draft.draft_updated_at,
        edit_url: `${ctx.client.baseUrl(creds)}/publish/post/${String(args.id)}`,
      };

      if (format === "markdown" || format === "both") {
        result.body_markdown = draftBodyToMarkdown(draft.draft_body);
      }
      if (format === "prosemirror" || format === "both") {
        result.body_prosemirror = draft.draft_body;
      }
      return result;
    },
  }),

  defineTool({
    name: "list_drafts",
    title: "List drafts",
    risk: "read",
    description: "List unpublished drafts, most recently edited first.",
    schema: {
      limit: z.number().optional().describe("How many to return. 1 to 100, default 25."),
      offset: z.number().optional().describe("Skip this many, for paging."),
      order_by: z
        .enum(["draft_updated_at", "draft_created_at", "draft_title"])
        .optional()
        .default("draft_updated_at"),
      order_direction: z.enum(["asc", "desc"]).optional().default("desc"),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 25, 100);
      const url =
        `${ctx.client.apiUrl(creds)}/post_management/drafts` +
        query({
          offset: args.offset ?? 0,
          limit,
          order_by: args.order_by ?? "draft_updated_at",
          order_direction: args.order_direction ?? "desc",
        });

      const data = await ctx.client.request<{ posts?: unknown[]; total?: number }>(url, { creds });
      const posts = Array.isArray(data.posts) ? data.posts : [];

      return {
        total: data.total ?? posts.length,
        returned: posts.length,
        limit,
        offset: args.offset ?? 0,
        drafts: posts.map((p) => {
          const post = p as Record<string, unknown>;
          return {
            id: post.id,
            title: post.draft_title ?? post.title,
            subtitle: post.draft_subtitle ?? post.subtitle,
            audience: post.audience,
            word_count: post.word_count ?? null,
            scheduled_for: post.draft_publish_at ?? null,
            updated_at: post.draft_updated_at,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "delete_draft",
    title: "Delete a draft",
    risk: "destructive",
    public: false,
    description:
      "Permanently delete an unpublished draft. There is no undo and no trash to recover it from, so this refuses to run without confirm: true.",
    schema: {
      id: z.number().describe("Draft id to delete."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `permanently delete draft ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      await ctx.client.request(`${ctx.client.apiUrl(creds)}/drafts/${args.id}`, {
        method: "DELETE",
        creds,
      });
      return { deleted: true, id: args.id };
    },
  }),

  defineTool({
    name: "publish_draft",
    title: "Publish a draft",
    risk: "destructive",
    public: true,
    description:
      "Publish a draft immediately. With send: true this emails every subscriber you have, and an email cannot be unsent. The post also becomes publicly visible. Refuses to run without confirm: true. To put a post live without emailing anyone, pass send: false.",
    schema: {
      id: z.number().describe("Draft id to publish."),
      send: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Email the post to subscribers. true sends to your whole list and cannot be undone. false publishes to the web only.",
        ),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) =>
      a.send === false
        ? `publish draft ${a.id} to the web without emailing`
        : `publish draft ${a.id} and email every subscriber`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const result = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/drafts/${args.id}/publish`,
        { method: "POST", body: { send: args.send ?? true }, creds },
      );
      return {
        published: true,
        id: args.id,
        emailed_subscribers: args.send ?? true,
        url: result.canonical_url ?? null,
      };
    },
  }),

  defineTool({
    name: "schedule_draft",
    title: "Schedule a draft",
    risk: "write",
    public: true,
    description:
      "Schedule a draft to publish at a future time. Substack handles the actual publishing, so this survives your machine being off. Call unschedule_draft to cancel.",
    schema: {
      id: z.number().describe("Draft id to schedule."),
      publish_at: z
        .string()
        .describe("When to publish, as an ISO 8601 datetime, for example 2026-09-15T10:00:00Z."),
      send: z
        .boolean()
        .optional()
        .default(true)
        .describe("Email subscribers when it publishes."),
      ...publicationArg,
    },
    summary: (a) => `schedule draft ${a.id} for ${a.publish_at}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const when = new Date(args.publish_at);
      if (Number.isNaN(when.getTime())) {
        throw new Error(
          `publish_at "${args.publish_at}" is not a valid ISO 8601 datetime. Use a form like 2026-09-15T10:00:00Z.`,
        );
      }
      if (when.getTime() < Date.now()) {
        throw new Error(
          `publish_at ${when.toISOString()} is in the past. Use publish_draft to publish now.`,
        );
      }

      await ctx.client.request(`${ctx.client.apiUrl(creds)}/drafts/${args.id}`, {
        method: "PUT",
        body: {
          draft_publish_at: when.toISOString(),
          should_send_email: args.send ?? true,
        },
        creds,
      });

      return {
        scheduled: true,
        id: args.id,
        publish_at: when.toISOString(),
        emails_subscribers: args.send ?? true,
      };
    },
  }),

  defineTool({
    name: "unschedule_draft",
    title: "Unschedule a draft",
    risk: "write",
    description: "Cancel a scheduled publication and return the post to being a plain draft.",
    schema: {
      id: z.number().describe("Draft id to unschedule."),
      ...publicationArg,
    },
    summary: (a) => `unschedule draft ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      await ctx.client.request(`${ctx.client.apiUrl(creds)}/drafts/${args.id}`, {
        method: "PUT",
        body: { draft_publish_at: null },
        creds,
      });
      return { unscheduled: true, id: args.id };
    },
  }),

  defineTool({
    name: "list_scheduled_posts",
    title: "List scheduled posts",
    risk: "read",
    description: "List posts queued to publish later, soonest first.",
    schema: {
      limit: z.number().optional().describe("How many to return. 1 to 100, default 25."),
      offset: z.number().optional(),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 25, 100);
      const data = await ctx.client.request<{ posts?: unknown[]; total?: number }>(
        `${ctx.client.apiUrl(creds)}/post_management/scheduled` +
          query({ offset: args.offset ?? 0, limit, order_by: "draft_publish_at", order_direction: "asc" }),
        { creds },
      );
      const posts = Array.isArray(data.posts) ? data.posts : [];
      return {
        total: data.total ?? posts.length,
        scheduled: posts.map((p) => {
          const post = p as Record<string, unknown>;
          return {
            id: post.id,
            title: post.draft_title ?? post.title,
            publish_at: post.draft_publish_at,
            audience: post.audience,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "set_draft_body",
    title: "Replace a draft body with a structured document",
    risk: "write",
    description: `Replace a draft's body with a Substack document you build node by node. Use this when you need exact control that markdown cannot express, such as a specific image caption or a button.

The document is {"type":"doc","content":[ ... ]}.

Nodes: ${NODE_VOCABULARY.join("; ")}.

Marks on text nodes: ${MARK_VOCABULARY.join("; ")}.

The document is validated before it is sent, so an unknown node name is an error here rather than a post that renders wrong on Substack. For ordinary writing, update_draft with markdown is easier and produces the same result.`,
    schema: {
      id: z.number().describe("Draft id."),
      document: z
        .string()
        .describe('The full ProseMirror document as a JSON string, shaped {"type":"doc","content":[...]}.'),
      ...publicationArg,
    },
    summary: (a) => `replace body of draft ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const body = toDraftBody(args.document, "prosemirror");

      await ctx.client.request(`${ctx.client.apiUrl(creds)}/drafts/${args.id}`, {
        method: "PUT",
        body: { draft_body: body },
        creds,
      });

      return {
        updated: true,
        id: args.id,
        nodes: JSON.parse(body).content.length,
      };
    },
  }),

  defineTool({
    name: "preview_draft_body",
    title: "Preview how a body will render",
    risk: "read",
    description:
      "Convert a body to Substack's document format and show what it produced, without creating or touching anything. Use this to check that an embed, a paywall or a nested list came out the way you meant before you write it to a draft.",
    schema: {
      body: z.string().describe(bodyDescription),
      body_format: BODY_FORMAT,
    },
    handler: async (args) => {
      const json = toDraftBody(args.body, args.body_format ?? "auto");
      const parsed = JSON.parse(json) as { content: { type: string }[] };
      const counts: Record<string, number> = {};
      for (const node of parsed.content) {
        counts[node.type] = (counts[node.type] ?? 0) + 1;
      }
      return {
        detected_format: args.body_format ?? "auto",
        block_count: parsed.content.length,
        blocks: counts,
        embeds_created: parsed.content.filter((n) =>
          ["youtube2", "twitter2", "spotify2", "vimeo"].includes(n.type),
        ).length,
        has_paywall: parsed.content.some((n) => n.type === "paywall"),
        rendered_back_as_markdown: draftBodyToMarkdown(json),
        document: parsed,
      };
    },
  }),

  defineTool({
    name: "get_sections",
    title: "List sections",
    risk: "read",
    description:
      "List the publication's sections, which are the categories a post can be filed under. Call this to find the section_id that create_draft and update_draft take.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const publication = await ctx.client.request<{ sections?: unknown[] }>(
        `${ctx.client.apiUrl(creds)}/publication`,
        { creds },
      );
      const sections = Array.isArray(publication.sections) ? publication.sections : [];
      return {
        count: sections.length,
        sections: sections.map((s) => {
          const section = s as Record<string, unknown>;
          return {
            id: section.id,
            name: section.name,
            slug: section.slug,
            description: section.description ?? null,
            email_from_name: section.email_from_name ?? null,
          };
        }),
      };
    },
  }),
];
