---
name: substack
description: |
  Substack newsletter and notes manager. Use when the user says "substack", "newsletter", "substack note", "substack post", "schedule note", "draft", or wants to publish, read, or analyze content on Substack. Also use for scraping public Substack posts or searching Substack publications.
---

# Substack — newsletter and notes manager

## Goal

Manage your Substack publication and research any public Substack content. 26 tools covering posts, drafts, notes (with scheduling), subscribers, analytics, and discovery.

Notes scheduling is built in. Schedule a note for any future time and the server publishes it automatically (checks every 60 seconds).

## Important: no official API

Substack does **not** have a public API. This MCP uses Substack's internal/private HTTP API, reverse-engineered from the web app. Authentication is cookie-based (browser session). This means:

- Endpoints can change without notice
- Be conservative. Same ToS risk as any scraping-based tool
- 3 discovery tools work **without any login** (searching publications, scraping public posts, getting publication info). You can research Substack right away with zero setup
- Everything else (drafts, notes, subscribers, analytics) needs your session cookie

## Authentication (needs setup)

For tools beyond discovery, you need your browser session cookie. You need three values from your browser:

1. Log into substack.com
2. Open DevTools (F12) > Network tab
3. Click any page and find a request to `substack.com/api/v1/...`
4. From the Cookie header, copy the `connect.sid` value
5. Your publication URL (e.g. `https://yourname.substack.com`)
6. Your user ID (from any API response, look for `id` in the user object)

Set these in your MCP config. For full setup guide, see [references/setup.md](references/setup.md).

## Critical rules

1. **Reverse-engineered API.** Substack has no official API. Endpoints can change without notice. If a tool fails, check browser DevTools for the current endpoint.
2. **Rate limited to 1 req/sec.** Built into the server. Don't try to bypass this.
3. **Be conservative.** Only do what you could do manually. No bulk spam, no mass follows, no bot-like behavior. Substack is strict.
4. **Session tokens expire.** If you get auth errors, get a fresh `connect.sid` from your browser.
5. **Notes API is fragile.** The Notes endpoints are the least stable. The server tries multiple endpoints with fallbacks.
6. **Discovery tools work without auth.** `search_publications`, `scrape_post`, and `get_publication_info` need no login.

## How it works

Custom MCP server wraps Substack's internal HTTP API using cookie-based session auth.

| Resource | URL |
|----------|-----|
| Substack | [substack.com](https://substack.com) |
| Your publication | configured via env var |
| Server path | `~/.local/share/mcp-servers/substack-mcp/` |
| Scheduled notes | `~/.substack-mcp/scheduled-notes.json` |
| GitHub | [github.com/thenavidm/substack-mcp](https://github.com/thenavidm/substack-mcp) |
| Setup guide | [references/setup.md](references/setup.md) |

## Tools by category

### Content write (6)

| Tool | What it does |
|------|-------------|
| `create_draft` | Create a draft post (plain text or HTML body) |
| `update_draft` | Edit an existing draft |
| `delete_draft` | Delete a draft |
| `publish_draft` | Publish a draft and email subscribers |
| `schedule_draft` | Schedule a draft for future publication (native Substack scheduling) |
| `list_drafts` | List all drafts with pagination |

### Content read (3)

| Tool | What it does |
|------|-------------|
| `get_post` | Get a published post by slug |
| `list_posts` | List published posts |
| `search_posts` | Search posts by keyword |

### Notes (6)

| Tool | What it does |
|------|-------------|
| `publish_note` | Publish a note immediately |
| `list_notes` | List your notes |
| `delete_note` | Delete a note |
| `schedule_note` | Schedule a note for future publication (built-in scheduler) |
| `list_scheduled_notes` | View all scheduled notes (pending/published/failed) |
| `cancel_scheduled_note` | Cancel a pending scheduled note |

### Subscribers (3)

| Tool | What it does |
|------|-------------|
| `list_subscribers` | List subscribers (free/paid/comp) |
| `add_subscriber` | Add a subscriber by email |
| `get_subscriber_count` | Quick subscriber count |

### Analytics (5)

| Tool | What it does |
|------|-------------|
| `get_dashboard_summary` | Overall publication stats |
| `get_post_stats` | Per-post opens, clicks, restacks |
| `get_email_stats` | Email delivery/open/click rates |
| `get_growth_sources` | Where subscribers come from |
| `get_revenue_summary` | Revenue, ARR, subscriptions |

### Discovery — no auth (3)

| Tool | What it does |
|------|-------------|
| `search_publications` | Find Substack publications by keyword |
| `scrape_post` | Read any public Substack post |
| `get_publication_info` | Get publication details |

## Scheduling notes

Notes don't have native scheduling in Substack. This MCP has a built-in scheduler.

### Schedule a note
```
schedule_note
  text: "Your note content here"
  publish_at: "2026-03-10T09:00:00Z"
```

The server checks every 60 seconds. When the time arrives, it publishes the note. The MCP server must be running (Claude Code or Desktop open).

Scheduled notes are stored at `~/.substack-mcp/scheduled-notes.json`.

### Check scheduled notes
```
list_scheduled_notes
  status: "pending"
```

### Cancel a scheduled note
```
cancel_scheduled_note
  id: "note_1741234567890_abc123"
```

## Creating posts

### Quick draft
```
create_draft
  title: "My new post"
  body: "This is my post content. It can be plain text or HTML."
```

### Rich HTML draft
```
create_draft
  title: "My formatted post"
  body: "<h2>Introduction</h2><p>This post has <strong>bold</strong> text and <a href='https://example.com'>links</a>.</p>"
  audience: "everyone"
```

### Publish immediately
```
publish_draft
  id: 12345
  send: true
```

### Schedule for later
```
schedule_draft
  id: 12345
  publish_at: "2026-03-15T10:00:00Z"
```

## Reading and scraping

### Scrape any public post (no auth needed)
```
scrape_post
  url: "https://example.substack.com/p/some-post"
```
Returns title, subtitle, author, and body text.

### Search publications
```
search_publications
  query: "AI newsletters"
```

## What you can't do

- Upload images/media through the MCP (use URLs in HTML instead)
- Access paywalled content from other publications
- Manage payment settings or pricing
- Create or manage sections
- The Notes API is reverse-engineered and may break

## Notes

- Session cookies last months if you don't log out. But they do expire eventually.
- All list endpoints support `offset` and `limit` for pagination
- The `scrape_post` tool truncates body text at 10,000 characters
- Substack caps API responses at ~20 items per request
- If Notes tools fail, the Substack API may have changed. Check browser DevTools for current endpoints.

## Quality checklist

- [ ] Verified session token is fresh before running auth-required tools
- [ ] Used `create_draft` + `publish_draft` workflow (not direct publish)
- [ ] Scheduled notes have timezone-aware ISO timestamps
- [ ] Used `scrape_post` for reading other publications (no auth needed)
- [ ] Checked `list_scheduled_notes` to verify schedule before leaving
- [ ] Kept requests conservative (no rapid-fire operations)
