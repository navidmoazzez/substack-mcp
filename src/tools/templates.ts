/**
 * Post templates.
 *
 * A template is a saved body you start new posts from. Neither reference
 * implementation exposes them, which is a shame: for anyone publishing to a
 * fixed format every week, this is the difference between a model recreating
 * the layout from memory each time and using the real one.
 */

import { z } from "zod";
import { toDraftBody } from "../content/body.js";
import { bylinesFor } from "../api/identity.js";
import { confirmArg, defineTool, publicationArg } from "./kit.js";

export const templateTools = [
  defineTool({
    name: "list_templates",
    title: "List post templates",
    risk: "read",
    description:
      "List your saved post templates, with the ids create_draft_from_template takes.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<unknown>(
        `${ctx.client.apiUrl(creds)}/post-templates`,
        { creds },
      );
      const templates = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      return {
        count: templates.length,
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          created_at: t.created_at ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "create_template",
    title: "Create a post template",
    risk: "write",
    description:
      "Save a reusable post template. The body takes the same markdown as create_draft, including embeds and a paywall marker.",
    schema: {
      name: z.string().describe("Template name, for example 'Weekly roundup'."),
      body: z.string().optional().describe("Template body, as markdown or HTML."),
      ...publicationArg,
    },
    summary: (a) => `create template "${a.name}"`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const template = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/post-templates`,
        {
          method: "POST",
          body: { name: args.name, body: toDraftBody(args.body ?? "") },
          creds,
        },
      );
      return { created: true, id: template.id, name: template.name };
    },
  }),

  defineTool({
    name: "delete_template",
    title: "Delete a post template",
    risk: "destructive",
    description:
      "Delete a saved template. Permanent, so it refuses to run without confirm: true. Posts already created from it are unaffected.",
    schema: {
      id: z.number().describe("Template id, from list_templates."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `permanently delete template ${a.id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      await ctx.client.request(`${ctx.client.apiUrl(creds)}/post-templates/${args.id}`, {
        method: "DELETE",
        creds,
      });
      return { deleted: true, id: args.id };
    },
  }),

  defineTool({
    name: "create_draft_from_template",
    title: "Start a draft from a template",
    risk: "write",
    description:
      "Create a new draft pre-filled with a saved template's body. The template's formatting is preserved exactly, rather than being reconstructed.",
    schema: {
      template_id: z.number().describe("Template id, from list_templates."),
      title: z.string().describe("Title for the new draft."),
      subtitle: z.string().optional(),
      ...publicationArg,
    },
    summary: (a) => `create draft "${a.title}" from template ${a.template_id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const api = ctx.client.apiUrl(creds);

      const list = await ctx.client.request<unknown>(`${api}/post-templates`, { creds });
      const templates = (Array.isArray(list) ? list : []) as Record<string, unknown>[];
      const template = templates.find((t) => Number(t.id) === args.template_id);
      if (!template) {
        const available = templates.map((t) => `${String(t.id)} (${String(t.name)})`).join(", ");
        throw new Error(
          `No template with id ${args.template_id}. Available: ${available || "none"}`,
        );
      }

      const body: Record<string, unknown> = {
        draft_title: args.title,
        draft_subtitle: args.subtitle ?? "",
        draft_body:
          typeof template.body === "string" && template.body
            ? template.body
            : toDraftBody(""),
        audience: "everyone",
        type: "newsletter",
      };

      const bylines = await bylinesFor(ctx.client, creds);
      if (bylines) body.draft_bylines = bylines;

      const draft = await ctx.client.request<Record<string, unknown>>(`${api}/drafts`, {
        method: "POST",
        body,
        creds,
      });

      return {
        id: draft.id,
        title: draft.draft_title,
        from_template: template.name,
        edit_url: `${ctx.client.baseUrl(creds)}/publish/post/${String(draft.id)}`,
      };
    },
  }),
];
