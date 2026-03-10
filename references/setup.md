# Substack MCP setup

Substack is a newsletter and publishing platform. There is no official/public API — this MCP uses Substack's internal HTTP API, reverse-engineered from the web app.

This MCP server lets you manage drafts, publish posts, send notes, view stats, manage subscribers, and more directly from Claude Code, Claude Desktop, Cursor, Windsurf, or any MCP-compatible client.

3 discovery tools (search publications, scrape posts, get publication info) work with **zero setup** — no login needed. Everything else requires your session cookie.

- [Substack](https://substack.com)

## What you get

1. **MCP server** (`index.mjs`) — connects your AI tools to Substack's internal API (30 tools)
2. **Skill** (`SKILL.md` + `references/`) — teaches Claude how to use the server effectively (publishing workflows, note scheduling, stats analysis)

## Prerequisites

- Node.js 18+
- A Substack account (for authenticated tools)

## Step 1: Get your session credentials

1. Log into [substack.com](https://substack.com) in your browser
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to the **Network** tab
4. Navigate to any page on your Substack dashboard
5. Click any request to `substack.com/api/v1/...`
6. In the **Headers** tab, find the `Cookie` header
7. Copy the value after `connect.sid=` (up to the next semicolon)
8. Your publication URL is `https://yourname.substack.com`
9. For your user ID: find a response containing your user info, look for the `id` field (a number)

The session token lasts for months as long as you don't log out.

## Step 2: Install the MCP server

```bash
git clone https://github.com/thenavidm/substack-mcp.git
cd substack-mcp
npm install
```

## Step 3: Add to your client

Replace `/path/to/substack-mcp` with the actual path where you cloned the repo.

### Claude Code

In `~/.claude.json` under `mcpServers`:

```json
"substack": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect.sid-value>",
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
    "SUBSTACK_SESSION_TOKEN": "<your-connect.sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

Note: Desktop config does NOT use a `type` field.

### Cursor

In `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
"substack": {
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect.sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Windsurf

In `~/.codeium/windsurf/mcp_config.json`:

```json
"substack": {
  "command": "node",
  "args": ["/path/to/substack-mcp/index.mjs"],
  "env": {
    "SUBSTACK_SESSION_TOKEN": "<your-connect.sid-value>",
    "SUBSTACK_PUBLICATION_URL": "https://yourname.substack.com",
    "SUBSTACK_USER_ID": "<your-user-id>"
  }
}
```

### Other MCP clients

- **Command:** `node /path/to/substack-mcp/index.mjs`
- **Environment:** `SUBSTACK_SESSION_TOKEN`, `SUBSTACK_PUBLICATION_URL`, `SUBSTACK_USER_ID`
- **Transport:** stdio

## Step 4: Verify

Discovery tools work without auth: `search_publications` with query "AI".

For authenticated tools: `list_drafts` should return your drafts.

## Step 5: Install the skill (recommended)

The skill teaches Claude how to use Substack's tools effectively — publishing workflows, note scheduling, and stats analysis.

```bash
mkdir -p ~/.claude/skills/substack/references
cp /path/to/substack-mcp/SKILL.md ~/.claude/skills/substack/
cp /path/to/substack-mcp/references/* ~/.claude/skills/substack/references/
```

For Claude Desktop, upload the skill through the Desktop interface.

## Troubleshooting

If you get 401/403 errors, your session token has expired. Get a fresh `connect.sid` from your browser. Logging out invalidates the token.

If you hit rate limits (429), the server has a built-in 1 req/sec limiter. Wait a few minutes if you still get throttled.

If Notes tools fail, the Notes API is the most fragile part. Substack may change these endpoints without notice.

## Important notes

- No official API — uses reverse-engineered internal endpoints
- Session token (`connect.sid`) lasts months if you don't log out
- 3 tools work without auth: `search_publications`, `scrape_post`, `get_publication_info`
- Built-in rate limiter: 1 request per second
