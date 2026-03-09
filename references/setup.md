# Substack MCP — setup

**Substack does not have an official/public API.** There are no API keys, no developer portal, no OAuth. This MCP uses Substack's internal HTTP API, reverse-engineered from the web app. You authenticate by extracting your browser session cookie (`connect.sid`).

3 discovery tools (search publications, scrape posts, get publication info) work with **zero setup** — no login needed. Everything else requires your session cookie.

## 1. Get your session credentials

1. Log into [substack.com](https://substack.com) in your browser
2. Open DevTools: press F12 (or Cmd+Option+I on Mac)
3. Go to the **Network** tab
4. Navigate to any page on your Substack dashboard
5. Click any request to `substack.com/api/v1/...`
6. In the **Headers** tab, find the `Cookie` header
7. Copy the value after `connect.sid=` (up to the next semicolon). This is your session token.
8. Your publication URL is `https://yourname.substack.com`
9. For your user ID: in the Network tab, find a response containing your user info. Look for an `id` field in the user object (it's a number).

The session token lasts for months as long as you don't log out. Even with MFA enabled.

## 2. Configure your client

### Claude Code

Add to `~/.claude.json` under `mcpServers`:

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

Or using npx (once published):

```json
"substack": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "substack-mcp@latest"],
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

### Cursor

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

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

Add to `~/.codeium/windsurf/mcp_config.json`:

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

## 3. Verify

Restart your client. Discovery tools work without auth:

```
search_publications
  query: "AI"
```

To test authenticated tools:

```
list_drafts
```

## Troubleshooting

**Auth errors (401/403):** Your session token has expired. Get a fresh `connect.sid` from your browser. Logging out invalidates the token.

**Rate limit (429):** The server has a built-in 1 req/sec limiter. If you still hit 429, wait a few minutes. Substack's server-side limits are undocumented.

**Notes tools failing:** The Notes API is the most fragile part. Substack may change these endpoints. Check browser DevTools Network tab when posting a note manually to find the current endpoint.

**Server won't start:** Make sure Node.js 18+ is installed and dependencies are installed (`npm install` in the server directory).

**Scheduled notes not publishing:** The MCP server must be running at the scheduled time. Check `~/.substack-mcp/scheduled-notes.json` for status. Failed notes show an error message.
