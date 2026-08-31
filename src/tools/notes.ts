/**
 * Notes.
 *
 * Notes have no draft state on Substack. Writing one publishes it, immediately
 * and publicly, with no preview and no undo from here. Every publishing tool in
 * this file therefore requires an explicit confirmation, and says so in its own
 * description rather than relying on an annotation a client may not surface.
 */

import { z } from "zod";
import { markdownToDoc } from "../content/markdown.js";
import { serialize } from "../content/prosemirror.js";
import { cancel, listScheduled, schedule } from "../scheduler.js";
import { clamp, confirmArg, defineTool, publicationArg, query } from "./kit.js";

/** Notes take a smaller schema than posts: paragraphs, marks, and links. */
function noteBody(text: string): { body: string; bodyJson: unknown } {
  const document = markdownToDoc(text);
  return { body: serialize(document), bodyJson: document };
}

export const noteTools = [
  defineTool({
    name: "publish_note",
    title: "Publish a Note",
    risk: "destructive",
    public: true,
    description:
      "Publish a Substack Note. Notes have no draft state, so this is live and public the moment it runs, with no preview and no undo from this server. Refuses to run without confirm: true. Supports bold, italic and links through markdown.",
    schema: {
      text: z.string().describe("The Note's text. Markdown for bold, italic and links."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `publicly publish a Note: "${String(a.text).slice(0, 80)}"`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const payload = noteBody(args.text);

      const result = await ctx.client.request<Record<string, unknown>>(
        "https://substack.com/api/v1/comment/feed",
        { method: "POST", body: payload, creds },
      );

      const id = result.id ?? (result.comment as Record<string, unknown> | undefined)?.id;
      return {
        published: true,
        id: id ?? null,
        text: args.text,
        url: id ? `https://substack.com/notes/note/c-${String(id)}` : null,
      };
    },
  }),

  defineTool({
    name: "publish_note_with_link",
    title: "Publish a Note with a link card",
    risk: "destructive",
    public: true,
    description:
      "Publish a Note with a link attached, which renders as a preview card rather than a bare URL. Live and public immediately, so it refuses to run without confirm: true.",
    schema: {
      text: z.string().describe("The Note's text, shown above the card."),
      url: z.string().describe("The URL to attach as a card."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `publicly publish a Note linking to ${a.url}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const payload = noteBody(args.text);

      const result = await ctx.client.request<Record<string, unknown>>(
        "https://substack.com/api/v1/comment/feed",
        {
          method: "POST",
          body: { ...payload, attachmentUrl: args.url, attachment_url: args.url },
          creds,
        },
      );

      const id = result.id ?? (result.comment as Record<string, unknown> | undefined)?.id;
      return {
        published: true,
        id: id ?? null,
        text: args.text,
        attached_url: args.url,
        url: id ? `https://substack.com/notes/note/c-${String(id)}` : null,
      };
    },
  }),

  defineTool({
    name: "schedule_note",
    title: "Schedule a Note",
    risk: "write",
    public: true,
    description: `Queue a Note to publish later. Substack has no native Note scheduling, so the queue is kept locally and this server publishes the Note when it comes due.

That means it only fires while this server is running. A Note scheduled for 9am publishes at 9am if your machine is awake with your MCP client open, and otherwise on the next start after that time, marked as published late. Nothing is dropped. For scheduling that does not depend on your laptop, run this server continuously over HTTP or in Docker.

Scheduling is not publishing, so this does not require a confirmation. The Note goes out publicly when it fires.`,
    schema: {
      text: z.string().describe("The Note's text."),
      publish_at: z
        .string()
        .describe("When to publish, as an ISO 8601 datetime, for example 2026-09-15T09:00:00Z."),
      ...publicationArg,
    },
    summary: (a) => `schedule a Note for ${a.publish_at}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const when = new Date(args.publish_at);
      if (Number.isNaN(when.getTime())) {
        throw new Error(
          `publish_at "${args.publish_at}" is not a valid ISO 8601 datetime. Use a form like 2026-09-15T09:00:00Z.`,
        );
      }
      if (when.getTime() < Date.now()) {
        throw new Error(
          `publish_at ${when.toISOString()} is in the past. Use publish_note to publish now.`,
        );
      }

      const note = schedule(args.text, when, creds.publicationUrl);
      return {
        scheduled: true,
        id: note.id,
        publish_at: note.publish_at,
        publication: note.publication_url,
        caveat:
          "This publishes only while the server is running. If it is not, the Note goes out on the next start after its time.",
      };
    },
  }),

  defineTool({
    name: "list_scheduled_notes",
    title: "List scheduled Notes",
    risk: "read",
    description:
      "List Notes queued by schedule_note, soonest first. Also shows which ones published, which failed and why.",
    schema: {
      status: z
        .enum(["scheduled", "published", "failed", "canceled"])
        .optional()
        .describe("Filter by status. Omit to see all of them."),
    },
    handler: async (args) => {
      const notes = listScheduled(args.status);
      return {
        count: notes.length,
        notes: notes.map((note) => ({
          id: note.id,
          text: note.text,
          publish_at: note.publish_at,
          status: note.status,
          publication: note.publication_url,
          published_at: note.published_at ?? null,
          published_late: note.published_late ?? false,
          error: note.error ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "cancel_scheduled_note",
    title: "Cancel a scheduled Note",
    risk: "write",
    description:
      "Cancel a queued Note before it publishes. Only works while it is still scheduled.",
    schema: {
      id: z.string().describe("The scheduled note id, from list_scheduled_notes."),
    },
    summary: (a) => `cancel scheduled note ${a.id}`,
    handler: async (args) => {
      const note = cancel(args.id);
      if (!note) {
        throw new Error(
          `No scheduled note with id ${args.id}. It may have already published, been canceled, or never existed.`,
        );
      }
      return { canceled: true, id: note.id, was_due: note.publish_at };
    },
  }),

  defineTool({
    name: "list_notes",
    title: "List your Notes",
    risk: "read",
    description: "List Notes you have published, newest first.",
    schema: {
      limit: z.number().optional().describe("How many to return. 1 to 50, default 20."),
      offset: z.number().optional(),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const limit = clamp(args.limit, 20, 50);

      const data = await ctx.client.request<Record<string, unknown>>(
        "https://substack.com/api/v1/reader/feed" +
          query({ types: "note", limit, offset: args.offset ?? 0 }),
        { creds },
      );

      const items = (Array.isArray(data.items) ? data.items : []) as Record<string, unknown>[];
      return {
        count: items.length,
        notes: items
          .map((item) => item.comment as Record<string, unknown> | undefined)
          .filter((c): c is Record<string, unknown> => Boolean(c?.body))
          .map((c) => ({
            id: c.id,
            body: c.body,
            date: c.date,
            likes: c.reaction_count ?? 0,
            replies: c.children_count ?? 0,
            restacks: c.restacks ?? 0,
            url: `https://substack.com/@${String(c.handle)}/note/c-${String(c.id)}`,
          })),
      };
    },
  }),

  defineTool({
    name: "delete_note",
    title: "Delete a Note",
    risk: "destructive",
    public: true,
    description:
      "Delete one of your published Notes. Permanent, with no undo, so it refuses to run without confirm: true.",
    schema: {
      id: z.number().describe("Numeric Note id."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `permanently delete Note ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      await ctx.client.request(`https://substack.com/api/v1/comment/${args.id}`, {
        method: "DELETE",
        creds,
      });
      return { deleted: true, id: args.id };
    },
  }),
];
