/**
 * Post tags.
 *
 * Tags are the publication-level labels a post can carry, separate from
 * sections. A tag has to exist on the publication before it can go on a post,
 * which is why create_tag exists alongside add_tag_to_post.
 */

import { z } from "zod";
import { confirmArg, defineTool, publicationArg } from "./kit.js";

export const tagTools = [
  defineTool({
    name: "list_publication_tags",
    title: "List publication tags",
    risk: "read",
    description:
      "List every tag defined on the publication, with the ids that add_tag_to_post takes. Includes tags marked hidden, which are usable on a post but not shown in navigation.",
    schema: {
      include_hidden: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include tags that are hidden from the publication's navigation."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<unknown>(
        `${ctx.client.apiUrl(creds)}/publication/post-tag`,
        { creds },
      );
      const tags = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      const visible =
        args.include_hidden === false ? tags.filter((t) => t.hidden !== true) : tags;

      return {
        count: visible.length,
        tags: visible.map((tag) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          hidden: tag.hidden ?? false,
          post_count: tag.post_count ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "create_tag",
    title: "Create a tag",
    risk: "write",
    description:
      "Create a new tag on the publication. A tag must exist before it can be put on a post.",
    schema: {
      name: z.string().describe("Tag name, as readers will see it."),
      ...publicationArg,
    },
    summary: (a) => `create tag "${a.name}"`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const tag = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/publication/post-tag`,
        { method: "POST", body: { name: args.name }, creds },
      );
      return { created: true, id: tag.id, name: tag.name, slug: tag.slug };
    },
  }),

  defineTool({
    name: "get_post_tags",
    title: "List a post's tags",
    risk: "read",
    description: "List the tags currently on one post.",
    schema: {
      post_id: z.number().describe("Numeric post id."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<unknown>(
        `${ctx.client.apiUrl(creds)}/post/${args.post_id}/tag`,
        { creds },
      );
      const tags = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      return {
        post_id: args.post_id,
        count: tags.length,
        tags: tags.map((tag) => ({
          post_tag_id: tag.id,
          tag_id: tag.publication_post_tag_id ?? tag.tag_id ?? null,
          name: tag.name,
          slug: tag.slug,
        })),
      };
    },
  }),

  defineTool({
    name: "add_tag_to_post",
    title: "Tag a post",
    risk: "write",
    description:
      "Put an existing tag on a post. Call list_publication_tags for the tag id, or create_tag first if it does not exist yet.",
    schema: {
      post_id: z.number().describe("Numeric post id."),
      tag_id: z.number().describe("Tag id, from list_publication_tags."),
      ...publicationArg,
    },
    summary: (a) => `add tag ${a.tag_id} to post ${a.post_id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const result = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/post/${args.post_id}/tag`,
        { method: "POST", body: { publication_post_tag_id: args.tag_id }, creds },
      );
      return { tagged: true, post_id: args.post_id, tag_id: args.tag_id, response: result };
    },
  }),

  defineTool({
    name: "remove_tag_from_post",
    title: "Remove a tag from a post",
    risk: "destructive",
    description:
      "Take a tag off a post. The tag itself stays on the publication. Needs the post_tag_id from get_post_tags, not the tag id.",
    schema: {
      post_id: z.number().describe("Numeric post id."),
      post_tag_id: z
        .number()
        .describe("The post_tag_id from get_post_tags, which is the link between post and tag."),
      ...confirmArg,
      ...publicationArg,
    },
    summary: (a) => `remove tag ${a.post_tag_id} from post ${a.post_id}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      await ctx.client.request(
        `${ctx.client.apiUrl(creds)}/post/${args.post_id}/tag/${args.post_tag_id}`,
        { method: "DELETE", creds },
      );
      return { removed: true, post_id: args.post_id, post_tag_id: args.post_tag_id };
    },
  }),
];
