/**
 * The publication itself: settings, design, identity and discovery.
 */

import { z } from "zod";
import { clamp, defineTool, publicationArg, query } from "./kit.js";

export const publicationTools = [
  defineTool({
    name: "get_publication_settings",
    title: "Read publication settings",
    risk: "read",
    description:
      "Read the publication's full settings: name, hero text, logo, cover, sender name, theme colours, sections, welcome email, podcast feed and everything else on the settings page.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      return ctx.client.request(`${ctx.client.apiUrl(creds)}/publication`, { creds });
    },
  }),

  defineTool({
    name: "update_publication_settings",
    title: "Update publication settings",
    risk: "write",
    public: true,
    description: `Change publication settings. Only the fields you pass are touched.

These are live settings on a public site, so a change here is visible to readers immediately.

accent_color and color_links are the two worth knowing about: Substack stores them under opaque theme variable names, and colour_links off is the usual reason links render nearly invisible on a dark theme.`,
    schema: {
      name: z.string().optional().describe("Publication name."),
      hero_text: z.string().optional().describe("Tagline shown on the homepage."),
      copyright: z.string().optional(),
      email_from_name: z.string().optional().describe("Sender name on emails."),
      logo_url: z.string().optional(),
      cover_photo_url: z.string().optional(),
      accent_color: z
        .string()
        .optional()
        .describe("Hex accent colour, for example #0B81F7. Stored as theme_var_background_pop."),
      color_links: z
        .boolean()
        .optional()
        .describe(
          "Whether links use the accent colour. Turning this on fixes links that render almost invisible. Stored as theme_var_color_links.",
        ),
      podcast_feed_url: z.string().optional(),
      podcast_enabled: z.boolean().optional(),
      welcome_email_subject: z.string().optional(),
      welcome_email_content: z.string().optional(),
      subscribe_content: z.string().optional(),
      subscribe_footer: z.string().optional(),
      settings: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Any other publication field, passed through as given. Use this for a setting this tool does not name, such as block_ai_crawlers.",
        ),
      ...publicationArg,
    },
    summary: (a) => `update publication settings on ${a.publication ?? "the default publication"}`,
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const payload: Record<string, unknown> = { ...(args.settings ?? {}) };

      const mapping: Record<string, unknown> = {
        name: args.name,
        hero_text: args.hero_text,
        copyright: args.copyright,
        email_from_name: args.email_from_name,
        logo_url: args.logo_url,
        cover_photo_url: args.cover_photo_url,
        theme_var_background_pop: args.accent_color,
        theme_var_color_links: args.color_links,
        podcast_feed_url: args.podcast_feed_url,
        podcast_enabled: args.podcast_enabled,
        welcome_email_subject: args.welcome_email_subject,
        welcome_email_content: args.welcome_email_content,
        subscribe_content: args.subscribe_content,
        subscribe_footer: args.subscribe_footer,
      };
      for (const [key, value] of Object.entries(mapping)) {
        if (value !== undefined) payload[key] = value;
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("Nothing to update. Pass at least one setting to change.");
      }

      const result = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/publication`,
        { method: "PUT", body: payload, creds },
      );

      return { updated: true, changed_fields: Object.keys(payload), publication: result.name };
    },
  }),

  defineTool({
    name: "get_user_profile",
    title: "Read the signed-in account",
    risk: "read",
    description:
      "Read the account behind the session: name, handle, user id, bio and which publications it owns. Use this to confirm which account is connected, or to get the user id other tools take.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      return ctx.client.request("https://substack.com/api/v1/user/profile/self", { creds });
    },
  }),

  defineTool({
    name: "list_contributors",
    title: "List who can write on the publication",
    risk: "read",
    description:
      "List the people attached to the publication, with their role and their numeric user id. The id is what a byline needs, so this is how you find out who a post can be attributed to besides yourself.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<unknown>(
        `${ctx.client.apiUrl(creds)}/publication/users`,
        { creds },
      );
      const users = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      return {
        count: users.length,
        contributors: users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role ?? null,
          bio: u.bio ?? null,
          photo_url: u.photo_url ?? null,
          byline_only: u.is_byline_only ?? false,
        })),
      };
    },
  }),

  defineTool({
    name: "get_import_status",
    title: "Get the last subscriber import",
    risk: "read",
    description:
      "Read the result of the most recent subscriber import: when it ran, how many addresses were in it, how many were added, and how many were skipped. Use it to check whether an import actually landed.",
    schema: { ...publicationArg },
    handler: async (args, ctx) => {
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/import`,
        { creds },
      );
      return {
        uploaded_at: data.upload_date ?? null,
        total: data.total ?? null,
        added: data.is_added ?? null,
        skipped: data.is_skipped ?? null,
        limited: data.is_limited ?? null,
        passed_verification: data.passImportVerification ?? null,
      };
    },
  }),

  defineTool({
    name: "search_publications",
    title: "Search Substack publications",
    risk: "read",
    description:
      "Search Substack for publications by name or topic. Returns the canonical host for each, which is what the research tools need for a publication on a custom domain.",
    schema: {
      query: z.string().describe("What to search for: a name, a topic, a niche."),
      page: z.number().optional().describe("Page number, starting at 0."),
      limit: z.number().optional().describe("Results per page. 1 to 50, default 20."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const limit = clamp(args.limit, 20, 50);
      // Verified against the live API: without a session this endpoint answers
      // 200 with an empty results array rather than 401, so an unauthenticated
      // call looks like "no matches" instead of "not signed in".
      const creds = ctx.publication(args.publication);
      const data = await ctx.client.request<Record<string, unknown>>(
        "https://substack.com/api/v1/publication/search" +
          query({ query: args.query, page: args.page ?? 0, limit }),
        { creds },
      );

      const results = (Array.isArray(data.results) ? data.results : []) as Record<
        string,
        unknown
      >[];
      return {
        query: args.query,
        count: results.length,
        publications: results.map((pub) => ({
          id: pub.id,
          name: pub.name,
          subdomain: pub.subdomain,
          url: pub.base_url ?? (pub.subdomain ? `https://${String(pub.subdomain)}.substack.com` : null),
          description: pub.hero_text ?? pub.description ?? null,
          logo: pub.logo_url ?? null,
          author: pub.author_name ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "get_publication_info",
    title: "Get public info about a publication",
    risk: "read",
    description:
      "Read the public details of any Substack publication from its homepage: name, description, author and cover image. Needs no authentication and works on publications you have no relationship with.",
    schema: {
      publication_url: z
        .string()
        .optional()
        .describe("Which publication, for example 'example.substack.com'. Defaults to your own."),
      ...publicationArg,
    },
    handler: async (args, ctx) => {
      const host = args.publication_url
        ? args.publication_url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
        : ctx.publication(args.publication).publicationUrl;

      const html = await ctx.client.request<string>(`https://${host}`, {
        authenticated: false,
        raw: true,
      });

      const meta = (pattern: RegExp): string => {
        const match = html.match(pattern);
        if (!match?.[1]) return "";
        return match[1]
          .replace(/&#x27;|&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .trim();
      };

      return {
        url: `https://${host}`,
        name: (
          meta(/<meta[^>]*property="og:title"\s+content="([^"]*)"/) ||
          meta(/<title[^>]*>([^<]*)<\/title>/)
        ).replace(/ \| Substack$/, ""),
        description:
          meta(/<meta[^>]*property="og:description"\s+content="([^"]*)"/) ||
          meta(/<meta[^>]*name="description"\s+content="([^"]*)"/),
        author: meta(/<meta[^>]*name="author"\s+content="([^"]*)"/),
        image: meta(/<meta[^>]*property="og:image"\s+content="([^"]*)"/),
      };
    },
  }),
];
