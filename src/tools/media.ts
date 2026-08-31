/**
 * Images.
 *
 * Substack's CDN is the only place a post image can live. A link to an image on
 * your own server works until that server moves, so anything going into a post
 * gets re-hosted here first.
 */

import { z } from "zod";
import {
  fetchImageAsDataUri,
  MAX_IMAGE_BYTES,
  readImageFileAsDataUri,
} from "../content/image.js";
import { defineTool, publicationArg } from "./kit.js";

export const mediaTools = [
  defineTool({
    name: "upload_image",
    title: "Upload an image",
    risk: "write",
    // The returned URL is fetchable by anyone who has it, so this reaches
    // outside your private drafts even though it publishes nothing.
    public: true,
    description: `Upload an image to Substack's CDN and get back a URL you can use in a post body or as a cover image.

Give exactly one of url or path. PNG, JPEG, GIF and WebP are accepted, up to ${MAX_IMAGE_BYTES / 1024 / 1024}MB. HEIC and SVG are not.

The returned URL is unlisted rather than secret: anyone who has it can fetch it, even before the post is published.`,
    schema: {
      url: z
        .string()
        .optional()
        .describe(
          "An http(s) URL to download and re-host. Private, loopback and link-local addresses are refused.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Absolute path to an image on the machine running this server. Use this for a locally generated image. Must be absolute, since a relative path would resolve against the server's working directory rather than yours.",
        ),
      post_id: z
        .number()
        .optional()
        .describe("Attach the image to a specific post or draft id."),
      ...publicationArg,
    },
    summary: (a) => `upload image from ${a.url ?? a.path ?? "(nothing)"}`,
    handler: async (args, ctx) => {
      if (Boolean(args.url) === Boolean(args.path)) {
        throw new Error(
          "Pass exactly one of url or path. Both were given, or neither was.",
        );
      }

      const creds = ctx.publication(args.publication);
      const image = args.url
        ? await fetchImageAsDataUri(args.url, ctx.config.userAgent, ctx.config.requestTimeoutMs)
        : await readImageFileAsDataUri(args.path!);

      const body: Record<string, unknown> = { image: image.dataUri };
      if (args.post_id !== undefined) body.postId = args.post_id;

      const result = await ctx.client.request<Record<string, unknown>>(
        `${ctx.client.apiUrl(creds)}/image`,
        { method: "POST", body, creds },
      );

      return {
        url: result.url,
        id: result.id ?? null,
        width: result.imageWidth ?? null,
        height: result.imageHeight ?? null,
        content_type: image.mimeType,
        bytes: image.bytes,
        source: args.url ?? args.path,
        markdown: `![](${String(result.url)})`,
      };
    },
  }),
];
