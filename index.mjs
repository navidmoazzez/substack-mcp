#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// --- Config ---

const SESSION_TOKEN = process.env.SUBSTACK_SESSION_TOKEN;
const PUBLICATION_URL = (process.env.SUBSTACK_PUBLICATION_URL || "").replace(
  /\/$/,
  ""
);
const USER_ID = process.env.SUBSTACK_USER_ID;

// Auth is optional for discovery tools, but required for most operations
const hasAuth = SESSION_TOKEN && PUBLICATION_URL && USER_ID;

if (!hasAuth) {
  console.error(
    "Warning: SUBSTACK_SESSION_TOKEN, SUBSTACK_PUBLICATION_URL, or SUBSTACK_USER_ID not set.\n" +
      "Discovery tools (search_publications, scrape_post, get_publication_info) will work.\n" +
      "All other tools require authentication.\n" +
      "See README for setup instructions."
  );
}

const BASE_URL = PUBLICATION_URL ? `${PUBLICATION_URL}/api/v1` : "";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const authHeaders = SESSION_TOKEN
  ? {
      Cookie: `substack.sid=${SESSION_TOKEN}; connect.sid=${SESSION_TOKEN};`,
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json, text/html, */*",
    }
  : {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json, text/html, */*",
    };

const publicHeaders = {
  "Content-Type": "application/json",
  "User-Agent": UA,
  Accept: "application/json, text/html, */*",
};

// --- Rate Limiter ---

let lastRequestTime = 0;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
}

// --- Helpers ---

function requireAuth() {
  if (!hasAuth) {
    throw new Error(
      "Authentication required. Set SUBSTACK_SESSION_TOKEN, SUBSTACK_PUBLICATION_URL, and SUBSTACK_USER_ID environment variables."
    );
  }
}

async function apiFetch(url, options = {}) {
  await rateLimit();
  const res = await fetch(url, {
    headers: options.authenticated === false ? publicHeaders : authHeaders,
    ...options,
    headers: {
      ...(options.authenticated === false ? publicHeaders : authHeaders),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      const isPublic = options.authenticated === false;
      throw new Error(
        isPublic
          ? `Substack blocked request (${res.status}): This public endpoint returned ${res.status}. Substack may be rate-limiting or blocking. Response: ${text}`
          : `Substack auth error (${res.status}): Session token may have expired. Get a new connect.sid cookie from your browser. Response: ${text}`
      );
    }
    if (res.status === 429) {
      throw new Error(
        `Substack rate limit (429): Too many requests. Wait a moment and try again. Response: ${text}`
      );
    }
    throw new Error(`Substack API error ${res.status}: ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

function formatResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function wrapBodyInHtml(body) {
  if (!body) return "";
  // If it already contains HTML tags, return as-is
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return body;
  }
  // Wrap plain text paragraphs in <p> tags
  return body
    .split(/\n\n+/)
    .map((p) => `<p>${p.trim()}</p>`)
    .join("");
}

// --- Server ---

const server = new McpServer({
  name: "substack",
  version: "1.0.0",
});

// ============================================================
// CONTENT — WRITE
// ============================================================

// Tool: create_draft
server.tool(
  "create_draft",
  "Create a new draft post on Substack. Accepts plain text (auto-wrapped in HTML) or raw HTML for the body.",
  {
    title: z.string().describe("Draft title"),
    subtitle: z.string().optional().describe("Draft subtitle"),
    body: z
      .string()
      .optional()
      .describe("Draft body content — plain text or HTML"),
    section_id: z
      .number()
      .optional()
      .describe("Section ID to publish under (optional)"),
    audience: z
      .enum(["everyone", "only_paid", "founding", "only_free"])
      .optional()
      .default("everyone")
      .describe("Audience access level (default: everyone)"),
    type: z
      .enum(["newsletter", "podcast", "thread"])
      .optional()
      .default("newsletter")
      .describe("Post type (default: newsletter)"),
  },
  async (params) => {
    requireAuth();
    const body = {
      draft_title: params.title,
      draft_subtitle: params.subtitle || "",
      draft_body: wrapBodyInHtml(params.body || ""),
      audience: params.audience || "everyone",
      type: params.type || "newsletter",
    };
    if (params.section_id) body.draft_section_id = params.section_id;

    const data = await apiFetch(`${BASE_URL}/drafts`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return formatResult(data);
  }
);

// Tool: update_draft
server.tool(
  "update_draft",
  "Update an existing draft post on Substack.",
  {
    id: z.number().describe("Draft ID to update"),
    title: z.string().optional().describe("New title"),
    subtitle: z.string().optional().describe("New subtitle"),
    body: z
      .string()
      .optional()
      .describe("New body content — plain text or HTML"),
    section_id: z.number().optional().describe("Section ID"),
    audience: z
      .enum(["everyone", "only_paid", "founding", "only_free"])
      .optional()
      .describe("Audience access level"),
    type: z
      .enum(["newsletter", "podcast", "thread"])
      .optional()
      .describe("Post type"),
  },
  async (params) => {
    requireAuth();
    const body = {};
    if (params.title !== undefined) body.draft_title = params.title;
    if (params.subtitle !== undefined) body.draft_subtitle = params.subtitle;
    if (params.body !== undefined) body.draft_body = wrapBodyInHtml(params.body);
    if (params.section_id !== undefined)
      body.draft_section_id = params.section_id;
    if (params.audience !== undefined) body.audience = params.audience;
    if (params.type !== undefined) body.type = params.type;

    const data = await apiFetch(`${BASE_URL}/drafts/${params.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return formatResult(data);
  }
);

// Tool: delete_draft
server.tool(
  "delete_draft",
  "Delete a draft post from Substack.",
  {
    id: z.number().describe("Draft ID to delete"),
  },
  async (params) => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/drafts/${params.id}`, {
      method: "DELETE",
    });
    return formatResult({ success: true, deleted_id: params.id, response: data });
  }
);

// Tool: publish_draft
server.tool(
  "publish_draft",
  "Publish a draft post on Substack. Optionally send to email subscribers.",
  {
    id: z.number().describe("Draft ID to publish"),
    send: z
      .boolean()
      .optional()
      .default(true)
      .describe("Send email to subscribers (default: true)"),
  },
  async (params) => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/drafts/${params.id}/publish`, {
      method: "POST",
      body: JSON.stringify({ send: params.send }),
    });
    return formatResult(data);
  }
);

// Tool: schedule_draft
server.tool(
  "schedule_draft",
  "Schedule a draft post for future publication on Substack.",
  {
    id: z.number().describe("Draft ID to schedule"),
    publish_at: z
      .string()
      .describe("ISO 8601 datetime string for scheduled publication (e.g. 2026-03-15T10:00:00Z)"),
  },
  async (params) => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/drafts/${params.id}`, {
      method: "PUT",
      body: JSON.stringify({ draft_publish_at: params.publish_at }),
    });
    return formatResult(data);
  }
);

// Tool: list_drafts
server.tool(
  "list_drafts",
  "List draft posts on your Substack publication.",
  {
    offset: z
      .number()
      .optional()
      .default(0)
      .describe("Pagination offset (default: 0)"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Number of drafts to return (default: 20)"),
    order_by: z
      .string()
      .optional()
      .default("draft_updated_at")
      .describe("Order by field (default: draft_updated_at)"),
    order_direction: z
      .enum(["asc", "desc"])
      .optional()
      .default("desc")
      .describe("Order direction (default: desc)"),
  },
  async (params) => {
    requireAuth();
    const qs = new URLSearchParams({
      offset: String(params.offset),
      limit: String(params.limit),
      order_by: params.order_by,
      order_direction: params.order_direction,
    });
    const data = await apiFetch(
      `${BASE_URL}/post_management/drafts?${qs.toString()}`
    );
    return formatResult(data);
  }
);

// ============================================================
// CONTENT — READ
// ============================================================

// Tool: get_post
server.tool(
  "get_post",
  "Get a published post by slug from Substack. Works without auth for public posts.",
  {
    slug: z.string().describe("Post slug (the URL-friendly identifier)"),
    publication_url: z
      .string()
      .optional()
      .describe(
        "Publication URL (defaults to your configured publication). Use for reading other publications."
      ),
  },
  async (params) => {
    const pubUrl = (params.publication_url || PUBLICATION_URL || "").replace(
      /\/$/,
      ""
    );
    if (!pubUrl) {
      throw new Error(
        "No publication URL provided or configured. Pass publication_url parameter."
      );
    }
    const data = await apiFetch(`${pubUrl}/api/v1/posts/${params.slug}`, {
      authenticated: false,
    });
    return formatResult(data);
  }
);

// Tool: list_posts
server.tool(
  "list_posts",
  "List published posts on your Substack publication.",
  {
    offset: z.number().optional().default(0).describe("Pagination offset"),
    limit: z.number().optional().default(20).describe("Number of posts"),
    order_by: z
      .string()
      .optional()
      .default("post_date")
      .describe("Order by field (default: post_date)"),
    order_direction: z
      .enum(["asc", "desc"])
      .optional()
      .default("desc")
      .describe("Order direction (default: desc)"),
  },
  async (params) => {
    requireAuth();
    const qs = new URLSearchParams({
      offset: String(params.offset),
      limit: String(params.limit),
      order_by: params.order_by,
      order_direction: params.order_direction,
    });
    const data = await apiFetch(
      `${BASE_URL}/post_management/published?${qs.toString()}`
    );
    return formatResult(data);
  }
);

// Tool: search_posts
server.tool(
  "search_posts",
  "Search published posts on your Substack publication by keyword.",
  {
    query: z.string().describe("Search query"),
  },
  async (params) => {
    requireAuth();
    const qs = new URLSearchParams({ query: params.query });
    const data = await apiFetch(`${BASE_URL}/post_search?${qs.toString()}`);
    return formatResult(data);
  }
);

// ============================================================
// NOTES
// ============================================================

// Tool: publish_note
server.tool(
  "publish_note",
  "Publish a note on Substack. Note: The Notes API is reverse-engineered and endpoints may change.",
  {
    text: z.string().describe("Note text content"),
  },
  async (params) => {
    requireAuth();
    const bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: params.text }],
        },
      ],
    };

    const requestBody = {
      body: JSON.stringify(bodyJson),
      bodyJson: bodyJson,
    };

    try {
      const data = await apiFetch(
        `https://substack.com/api/v1/comment/feed`,
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        }
      );
      return formatResult(data);
    } catch (err) {
      // Try alternative endpoint
      try {
        const data = await apiFetch(
          `https://substack.com/api/v1/notes`,
          {
            method: "POST",
            body: JSON.stringify(requestBody),
          }
        );
        return formatResult(data);
      } catch (err2) {
        return formatResult({
          error:
            "Could not publish note. The Substack Notes API endpoint may have changed.",
          primary_error: err.message,
          fallback_error: err2.message,
          suggestion:
            "The Notes API is reverse-engineered and may change. Check browser DevTools Network tab for the current endpoint when posting a note on substack.com.",
        });
      }
    }
  }
);

// Tool: list_notes
server.tool(
  "list_notes",
  "List notes from your Substack feed. Note: The Notes API is reverse-engineered and endpoints may change.",
  {
    offset: z.number().optional().default(0).describe("Pagination offset"),
    limit: z.number().optional().default(20).describe("Number of notes"),
  },
  async (params) => {
    requireAuth();
    const qs = new URLSearchParams({
      types: "note",
      offset: String(params.offset),
      limit: String(params.limit),
    });
    try {
      const data = await apiFetch(
        `https://substack.com/api/v1/reader/feed?${qs.toString()}`
      );
      return formatResult(data);
    } catch (err) {
      return formatResult({
        error: "Could not list notes. The endpoint may have changed.",
        details: err.message,
        suggestion:
          "Check browser DevTools for the current Notes feed endpoint.",
      });
    }
  }
);

// Tool: delete_note
server.tool(
  "delete_note",
  "Delete a note by ID from Substack. Note: The Notes API is reverse-engineered and endpoints may change.",
  {
    id: z.number().describe("Note ID to delete"),
  },
  async (params) => {
    requireAuth();
    try {
      const data = await apiFetch(
        `https://substack.com/api/v1/comment/${params.id}`,
        { method: "DELETE" }
      );
      return formatResult({
        success: true,
        deleted_id: params.id,
        response: data,
      });
    } catch (err) {
      try {
        const data = await apiFetch(
          `https://substack.com/api/v1/notes/${params.id}`,
          { method: "DELETE" }
        );
        return formatResult({
          success: true,
          deleted_id: params.id,
          response: data,
        });
      } catch (err2) {
        return formatResult({
          error: "Could not delete note. The endpoint may have changed.",
          primary_error: err.message,
          fallback_error: err2.message,
        });
      }
    }
  }
);

// ============================================================
// SUBSCRIBERS
// ============================================================

// Tool: list_subscribers
server.tool(
  "list_subscribers",
  "List subscribers of your Substack publication with optional filtering.",
  {
    offset: z.number().optional().default(0).describe("Pagination offset"),
    limit: z.number().optional().default(20).describe("Number of subscribers"),
    filter: z
      .enum(["all", "free", "paid", "comp"])
      .optional()
      .default("all")
      .describe("Filter by subscription type (default: all)"),
  },
  async (params) => {
    requireAuth();
    const qs = new URLSearchParams({
      offset: String(params.offset),
      limit: String(params.limit),
      filter: params.filter === "all" ? "" : params.filter,
    });
    const data = await apiFetch(
      `${BASE_URL}/publication/subscribers?${qs.toString()}`
    );
    return formatResult(data);
  }
);

// Tool: add_subscriber
server.tool(
  "add_subscriber",
  "Add a subscriber to your Substack publication.",
  {
    email: z.string().describe("Subscriber email address"),
    subscription_type: z
      .enum(["free", "gift_paid"])
      .optional()
      .default("free")
      .describe("Subscription type (default: free)"),
  },
  async (params) => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/subscriber/add`, {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        subscription_type: params.subscription_type,
      }),
    });
    return formatResult(data);
  }
);

// Tool: get_subscriber_count
server.tool(
  "get_subscriber_count",
  "Get the total subscriber count for your Substack publication.",
  {},
  async () => {
    requireAuth();
    try {
      const data = await apiFetch(
        `${BASE_URL}/publication/stats/subscriber_count`
      );
      return formatResult(data);
    } catch (err) {
      // Fallback: try dashboard summary
      try {
        const data = await apiFetch(
          `${BASE_URL}/publish-dashboard/summary-v2`
        );
        return formatResult({
          subscriber_count: data.subscriber_count || data.total_subscribers,
          source: "dashboard_summary",
          raw: data,
        });
      } catch (err2) {
        throw new Error(
          `Could not get subscriber count. Primary: ${err.message}. Fallback: ${err2.message}`
        );
      }
    }
  }
);

// ============================================================
// ANALYTICS
// ============================================================

// Tool: get_dashboard_summary
server.tool(
  "get_dashboard_summary",
  "Get the dashboard summary for your Substack publication, including key metrics.",
  {},
  async () => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/publish-dashboard/summary-v2`);
    return formatResult(data);
  }
);

// Tool: get_post_stats
server.tool(
  "get_post_stats",
  "Get detailed stats for a specific post including email stats, restacks, and comment count.",
  {
    post_id: z.number().describe("Post ID to get stats for"),
  },
  async (params) => {
    requireAuth();
    const data = await apiFetch(
      `${BASE_URL}/post_management/detail/${params.post_id}`
    );
    return formatResult(data);
  }
);

// Tool: get_email_stats
server.tool(
  "get_email_stats",
  "Get overall email performance stats for your Substack publication.",
  {},
  async () => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/publication/stats/email_stats`);
    return formatResult(data);
  }
);

// Tool: get_growth_sources
server.tool(
  "get_growth_sources",
  "Get subscriber growth sources for your Substack publication.",
  {},
  async () => {
    requireAuth();
    const data = await apiFetch(
      `${BASE_URL}/publication/stats/growth/sources`
    );
    return formatResult(data);
  }
);

// Tool: get_revenue_summary
server.tool(
  "get_revenue_summary",
  "Get revenue and subscription plan summary for your Substack publication.",
  {},
  async () => {
    requireAuth();
    const data = await apiFetch(`${BASE_URL}/pledges/plans/summary`);
    return formatResult(data);
  }
);

// ============================================================
// DISCOVERY (no auth needed)
// ============================================================

// Tool: search_publications
server.tool(
  "search_publications",
  "Search for Substack publications by name or topic. No authentication needed.",
  {
    query: z.string().describe("Search query (publication name, topic, etc.)"),
    page: z.number().optional().default(0).describe("Page number (default: 0)"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Results per page (default: 20)"),
  },
  async (params) => {
    const qs = new URLSearchParams({
      query: params.query,
      page: String(params.page),
      limit: String(params.limit),
    });
    const data = await apiFetch(
      `https://substack.com/api/v1/publication/search?${qs.toString()}`,
      { authenticated: false }
    );
    return formatResult(data);
  }
);

// Tool: scrape_post
server.tool(
  "scrape_post",
  "Fetch and extract content from any public Substack post URL. Parses title, subtitle, author, and body text from HTML. No authentication needed.",
  {
    url: z
      .string()
      .describe(
        "Full URL to a public Substack post (e.g. https://example.substack.com/p/post-slug)"
      ),
  },
  async (params) => {
    await rateLimit();
    const res = await fetch(params.url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html, application/xhtml+xml, */*",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${params.url}: ${res.status}`);
    }
    lastRequestTime = Date.now();
    const html = await res.text();

    // Extract title — Substack uses data-rh="true" on meta tags
    const titleMatch =
      html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>(.*?)<\/h1>/s) ||
      html.match(/<meta[^>]*property="og:title"\s+content="([^"]*)"/) ||
      html.match(/<title[^>]*>([^<]*)<\/title>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim()
      : "Unknown";

    // Extract subtitle
    const subtitleMatch =
      html.match(
        /<h3[^>]*class="[^"]*subtitle[^"]*"[^>]*>(.*?)<\/h3>/s
      ) ||
      html.match(/<meta[^>]*property="og:description"\s+content="([^"]*)"/) ||
      html.match(
        /<meta[^>]*name="description"\s+content="([^"]*)"/
      );
    const subtitle = subtitleMatch
      ? subtitleMatch[1].replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim()
      : "";

    // Extract author
    const authorMatch =
      html.match(/<meta[^>]*name="author"\s+content="([^"]*)"/) ||
      html.match(
        /<a[^>]*class="[^"]*author-name[^"]*"[^>]*>(.*?)<\/a>/s
      );
    const author = authorMatch
      ? authorMatch[1].replace(/<[^>]*>/g, "").trim()
      : "Unknown";

    // Extract body text from the post body div
    let bodyText = "";
    const stripHtml = (s) =>
      s
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();

    // Try body markup div (greedy capture up to post-footer, subscription-widget, or end of content)
    const bodyMatch = html.match(
      /<div[^>]*class="[^"]*body[^"]*markup[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*(?:post-footer|subscription-widget-wrap|paywall-)[^"]*"|<\/article>)/
    );
    if (bodyMatch) {
      bodyText = stripHtml(bodyMatch[1]);
    }
    // Fallback: available-content
    if (!bodyText) {
      const fallbackMatch = html.match(
        /<div[^>]*class="[^"]*available-content[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*(?:paywall-|subscription-widget)[^"]*"|<\/article>)/
      );
      if (fallbackMatch) {
        bodyText = stripHtml(fallbackMatch[1]);
      }
    }
    // Fallback: JSON-LD articleBody if available
    if (!bodyText) {
      const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      if (ldMatch) {
        try {
          const ld = JSON.parse(ldMatch[1]);
          if (ld.articleBody) bodyText = ld.articleBody;
        } catch (_) {}
      }
    }

    // Truncate body if very long
    if (bodyText.length > 10000) {
      bodyText = bodyText.substring(0, 10000) + "... [truncated]";
    }

    return formatResult({
      url: params.url,
      title,
      subtitle,
      author,
      body_text: bodyText || "(Could not extract body text from HTML)",
      body_length: bodyText.length,
    });
  }
);

// Tool: get_publication_info
server.tool(
  "get_publication_info",
  "Get public information about a Substack publication. No authentication needed.",
  {
    publication_url: z
      .string()
      .optional()
      .describe(
        "Publication URL (defaults to your configured publication). e.g. https://example.substack.com"
      ),
  },
  async (params) => {
    const pubUrl = (params.publication_url || PUBLICATION_URL || "").replace(
      /\/$/,
      ""
    );
    if (!pubUrl) {
      throw new Error(
        "No publication URL provided or configured. Pass publication_url parameter."
      );
    }

    // Scrape the homepage HTML for publication info (API requires auth)
    await rateLimit();
    const res = await fetch(pubUrl, {
      headers: { "User-Agent": UA, Accept: "text/html, */*" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${pubUrl}: ${res.status}`);
    }
    const html = await res.text();

    const get = (pattern) => {
      const m = html.match(pattern);
      return m ? m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() : "";
    };

    // Substack uses data-rh="true" on meta tags, so match flexibly with [^>]*
    const name =
      get(/<meta[^>]*property="og:title"\s+content="([^"]*)"/) ||
      get(/<title[^>]*>([^<]*)<\/title>/);
    const description =
      get(/<meta[^>]*property="og:description"\s+content="([^"]*)"/) ||
      get(/<meta[^>]*name="description"\s+content="([^"]*)"/) ||
      "";
    const author = get(/<meta[^>]*name="author"\s+content="([^"]*)"/) || "";
    const image =
      get(/<meta[^>]*property="og:image"\s+content="([^"]*)"/) || "";
    const type = get(/<meta[^>]*property="og:type"\s+content="([^"]*)"/) || "";

    return formatResult({
      url: pubUrl,
      name: name.replace(/ \| Substack$/, ""),
      description,
      author,
      image,
      type,
    });
  }
);

// ============================================================
// NOTES SCHEDULER (built-in)
// ============================================================

const SCHEDULE_DIR = join(homedir(), ".substack-mcp");
const SCHEDULE_FILE = join(SCHEDULE_DIR, "scheduled-notes.json");

function loadScheduledNotes() {
  try {
    if (existsSync(SCHEDULE_FILE)) {
      return JSON.parse(readFileSync(SCHEDULE_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveScheduledNotes(notes) {
  if (!existsSync(SCHEDULE_DIR)) {
    mkdirSync(SCHEDULE_DIR, { recursive: true });
  }
  writeFileSync(SCHEDULE_FILE, JSON.stringify(notes, null, 2));
}

// Publish a note via the API (reused by scheduler)
async function publishNoteInternal(text) {
  const bodyJson = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
  const requestBody = {
    body: JSON.stringify(bodyJson),
    bodyJson,
  };

  try {
    return await apiFetch("https://substack.com/api/v1/comment/feed", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
  } catch {
    return await apiFetch("https://substack.com/api/v1/notes", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
  }
}

// Check scheduled notes every 60 seconds
async function checkScheduledNotes() {
  if (!hasAuth) return;
  const notes = loadScheduledNotes();
  const now = Date.now();
  let changed = false;

  for (const note of notes) {
    if (note.status !== "pending") continue;
    if (new Date(note.publish_at).getTime() <= now) {
      try {
        await publishNoteInternal(note.text);
        note.status = "published";
        note.published_at = new Date().toISOString();
      } catch (err) {
        note.status = "failed";
        note.error = err.message;
      }
      changed = true;
    }
  }

  if (changed) {
    saveScheduledNotes(notes);
  }
}

// Start the scheduler timer
setInterval(checkScheduledNotes, 60_000);
// Run once on startup
checkScheduledNotes();

// Tool: schedule_note
server.tool(
  "schedule_note",
  "Schedule a note for future publication. The server checks every 60 seconds and publishes when the time arrives. The MCP server must be running at the scheduled time.",
  {
    text: z.string().describe("Note text content"),
    publish_at: z
      .string()
      .describe(
        "ISO 8601 datetime for when to publish (e.g. 2026-03-10T09:00:00Z). Must be in the future."
      ),
  },
  async (params) => {
    requireAuth();
    const publishTime = new Date(params.publish_at).getTime();
    if (isNaN(publishTime)) {
      throw new Error("Invalid datetime. Use ISO 8601 format (e.g. 2026-03-10T09:00:00Z).");
    }
    if (publishTime <= Date.now()) {
      throw new Error("Scheduled time must be in the future. Use publish_note for immediate publishing.");
    }

    const notes = loadScheduledNotes();
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    notes.push({
      id,
      text: params.text,
      publish_at: params.publish_at,
      created_at: new Date().toISOString(),
      status: "pending",
    });
    saveScheduledNotes(notes);

    return formatResult({
      success: true,
      id,
      text: params.text,
      publish_at: params.publish_at,
      message: "Note scheduled. It will be published when the time arrives (checked every 60 seconds).",
    });
  }
);

// Tool: list_scheduled_notes
server.tool(
  "list_scheduled_notes",
  "List all scheduled notes (pending, published, and failed).",
  {
    status: z
      .enum(["all", "pending", "published", "failed"])
      .optional()
      .default("all")
      .describe("Filter by status (default: all)"),
  },
  async (params) => {
    const notes = loadScheduledNotes();
    const filtered =
      params.status === "all"
        ? notes
        : notes.filter((n) => n.status === params.status);
    return formatResult({
      total: filtered.length,
      notes: filtered,
    });
  }
);

// Tool: cancel_scheduled_note
server.tool(
  "cancel_scheduled_note",
  "Cancel a pending scheduled note by ID.",
  {
    id: z.string().describe("Scheduled note ID (from schedule_note or list_scheduled_notes)"),
  },
  async (params) => {
    const notes = loadScheduledNotes();
    const note = notes.find((n) => n.id === params.id);
    if (!note) {
      throw new Error(`No scheduled note found with ID: ${params.id}`);
    }
    if (note.status !== "pending") {
      throw new Error(`Cannot cancel note with status: ${note.status}. Only pending notes can be cancelled.`);
    }
    note.status = "cancelled";
    note.cancelled_at = new Date().toISOString();
    saveScheduledNotes(notes);

    return formatResult({
      success: true,
      id: params.id,
      message: "Scheduled note cancelled.",
    });
  }
);

// --- Start Server ---

const transport = new StdioServerTransport();
await server.connect(transport);
