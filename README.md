# Substack MCP

MCP server for Substack. Manage posts, drafts, notes, subscribers, and analytics from Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

26 tools covering content management, notes (with built-in scheduling), subscriber management, analytics, and publication discovery.

**Substack does not have an official/public API.** This MCP uses Substack's internal HTTP API, reverse-engineered from the web app. Authentication is cookie-based (browser session). 3 discovery tools work with zero setup for researching any public Substack content.

## What you can do

- **Create, edit, schedule, and publish posts** on your Substack publication
- **Manage drafts** with full CRUD operations and audience targeting
- **Publish, schedule, and manage Notes** with built-in scheduler (checks every 60 seconds)
- **View subscriber lists** and add new subscribers (free or gifted paid)
- **Track analytics** including dashboard metrics, post stats, email performance, growth sources, and revenue
- **Research Substack without any login** — search publications, scrape public posts, get publication info
- **Schedule Notes for future publication** — stored locally, published automatically when time arrives

## What you get

This repo contains two things:

1. **MCP server** (`index.mjs`) — connects your AI tools to Substack's internal API
2. **Skill** (`SKILL.md` + `references/`) — teaches Claude how to use the server effectively (workflows, gotchas, tips)

## Prerequisites

- **Node.js 18+** (uses native fetch)
- **Substack account** with a publication for authenticated tools
- No API key needed — Substack has no public API. Uses session cookie authentication

### Getting your session token

1. Log in to [substack.com](https://substack.com) in your browser
2. Open DevTools (F12 or Cmd+Shift+I)
3. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Under **Cookies**, find `substack.com`
5. Look for the cookie named `connect.sid` — copy its full value
6. That value is your `SUBSTACK_SESSION_TOKEN`

### Getting your user ID

1. While logged in to Substack, open DevTools
2. Go to the **Console** tab
3. Run: `document.cookie` and look for user-related info, or
4. Go to the **Network** tab, reload the page, and find any API request — your user ID will be in the response headers or payload
5. Alternatively, visit `https://substack.com/api/v1/user/self` while logged in

### Getting your publication URL

Your publication URL is the base URL of your Substack, e.g. `https://yourname.substack.com` or your custom domain like `https://blog.example.com`.

**Note:** Session tokens expire periodically. If you get 401 errors, get a fresh `connect.sid` cookie from your browser.

## Installation

```bash
git clone https://github.com/thenavidm/substack-mcp.git
cd substack-mcp
npm install
```

## Configuration

### Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
"substack": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect-sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Claude Desktop

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
"substack": {
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect-sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Cursor

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
"substack": {
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect-sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
"substack": {
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect-sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Other MCP clients

- **Command:** `node /path/to/substack-mcp/index.mjs`
- **Environment:** `SUBSTACK_SESSION_TOKEN`, `SUBSTACK_PUBLICATION_URL`, `SUBSTACK_USER_ID`
- **Transport:** stdio

## Installing the skill (recommended)

The repo includes a `SKILL.md` file and `references/` folder that teach Claude the best way to use Substack. Copy them into your skills directory:

```bash
mkdir -p ~/.claude/skills/substack/references
cp /path/to/substack-mcp/SKILL.md ~/.claude/skills/substack/
cp /path/to/substack-mcp/references/* ~/.claude/skills/substack/references/
```

For Claude Desktop, upload the skill through the Desktop interface.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUBSTACK_SESSION_TOKEN` | For auth tools | The `connect.sid` cookie value from your browser |
| `SUBSTACK_PUBLICATION_URL` | For auth tools | Your publication URL (e.g. `https://yourname.substack.com`) |
| `SUBSTACK_USER_ID` | For auth tools | Your Substack user ID |

Discovery tools (`search_publications`, `scrape_post`, `get_publication_info`) work without any authentication.

## Tools

### Content — Write (6 tools)

| Tool | Description |
|------|-------------|
| `create_draft` | Create a new draft post with title, body (HTML or plain text), audience targeting |
| `update_draft` | Update an existing draft's title, body, audience, or type |
| `delete_draft` | Delete a draft by ID |
| `publish_draft` | Publish a draft, optionally sending email to subscribers |
| `schedule_draft` | Schedule a draft for future publication with ISO datetime |
| `list_drafts` | List all drafts with pagination and sorting |

### Content — Read (3 tools)

| Tool | Description |
|------|-------------|
| `get_post` | Get a published post by slug (works without auth for public posts) |
| `list_posts` | List published posts with pagination and sorting |
| `search_posts` | Search published posts by keyword |

### Notes (6 tools)

| Tool | Description |
|------|-------------|
| `publish_note` | Publish a note on Substack |
| `list_notes` | List notes from your feed |
| `delete_note` | Delete a note by ID |
| `schedule_note` | Schedule a note for future publication (built-in scheduler) |
| `list_scheduled_notes` | View all scheduled notes (pending/published/failed) |
| `cancel_scheduled_note` | Cancel a pending scheduled note |

### Subscribers (3 tools)

| Tool | Description |
|------|-------------|
| `list_subscribers` | List subscribers with filtering (all, free, paid, comp) |
| `add_subscriber` | Add a subscriber by email (free or gifted paid) |
| `get_subscriber_count` | Get total subscriber count |

### Analytics (5 tools)

| Tool | Description |
|------|-------------|
| `get_dashboard_summary` | Get publication dashboard overview with key metrics |
| `get_post_stats` | Get detailed stats for a specific post (opens, clicks, restacks) |
| `get_email_stats` | Get overall email performance metrics |
| `get_growth_sources` | Get subscriber growth by source |
| `get_revenue_summary` | Get revenue and subscription plan summary |

### Discovery (3 tools)

| Tool | Description |
|------|-------------|
| `search_publications` | Search Substack's publication directory by name or topic |
| `scrape_post` | Extract title, author, and body text from any public Substack URL |
| `get_publication_info` | Get public info about any Substack publication |

## Key concepts

### Session cookie authentication

Substack doesn't offer an official API or API keys. This server authenticates using the `connect.sid` session cookie from your browser. This is the same approach used by other Substack integrations and is the only way to access write operations and private data. Session tokens expire periodically (usually after a few weeks), so you may need to refresh your cookie.

### Rate limiting

The server enforces a built-in rate limit of 1 request per second. All API calls are queued and spaced out automatically. This is conservative and should keep you well within Substack's undocumented rate limits. If you still hit a 429 response, the error message will suggest waiting before retrying.

### Notes API limitations

The Substack Notes API is reverse-engineered from browser network traffic. The endpoints are not officially documented and may change at any time. The notes tools (`publish_note`, `list_notes`, `delete_note`) use the best-known endpoints and include fallback logic, but may stop working if Substack changes their internal API. Error messages include suggestions for finding updated endpoints using browser DevTools.

### Content format

The `create_draft` and `update_draft` tools accept either plain text or HTML for the body content. Plain text is automatically wrapped in `<p>` paragraph tags (split on double newlines). If you provide HTML directly, it's passed through as-is.

## Rate limits

- Built-in: 1 request per second (enforced by the server)
- Substack's server-side limits are undocumented but the 1 req/sec rate should be safe

## License

AGPL-3.0 - Copyright (C) 2026 [Navid Moazzez](https://navid.me) | [CreatorSchool.ai](https://creatorschool.ai)
