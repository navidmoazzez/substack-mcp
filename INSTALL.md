# Install

Substack has no public API. This server calls the same JSON endpoints Substack's own web app calls, signed with your browser session cookie.

Four discovery tools work with no login at all: `search_publications`, `get_publication_info`, `scrape_post` and `get_post` against a public publication. Everything else needs your session.

## Prerequisites

Node 20 or newer. Nothing else.

## Install

```bash
claude mcp add substack -- npx -y @thenavidm/substack-mcp
```

Or in any client's MCP config:

```json
{
  "mcpServers": {
    "substack": {
      "command": "npx",
      "args": ["-y", "@thenavidm/substack-mcp"],
      "env": {
        "SUBSTACK_PUBLICATION_URL": "example.substack.com",
        "SUBSTACK_SESSION_TOKEN": "your-connect-sid-value"
      }
    }
  }
}
```

## Getting the session token

Your `connect.sid` cookie is full access to your Substack account. Treat it like a password. Never paste it into an issue or share it.

### Fastest

```bash
npx @thenavidm/substack-mcp login
```

Prompts for the publication URL and the cookie, resolves your user id, and stores it encrypted in `~/.substack-mcp/session.json`. After that you can leave the `env` block out of your client config entirely.

### From the browser you already have open

```bash
npx @thenavidm/substack-mcp login --playwriter
```

Reads the cookie out of your running Chrome. Needs [Playwriter](https://playwriter.dev) and its extension.

### By launching a browser

```bash
npm i -g playwright && npx playwright install chromium
npx @thenavidm/substack-mcp login --playwright
```

Slowest by a distance. Use it on a machine with no Chrome, or in CI.

### By hand

1. Open your publication and sign in.
2. DevTools, then Application, then Cookies.
3. Copy the value of `connect.sid`. It starts with `s%3A`.

Disable ad blockers first. Some strip the cookie from that panel.

`SUBSTACK_USER_ID` is optional. It is looked up automatically and cached.

## Verify

```bash
npx @thenavidm/substack-mcp doctor
```

Checks credentials, configuration, connectivity and byline resolution, and names whatever is wrong.

## Safety settings

| Variable | Effect |
|---|---|
| `SUBSTACK_READ_ONLY=1` | Only the 38 read tools are exposed |
| `SUBSTACK_ALLOW_DESTRUCTIVE=0` | Drafting works, publishing and deleting do not |
| `SUBSTACK_AUDIT_LOG=/path/to/log` | Append-only record of every attempted write |

Irreversible actions require `confirm: true` regardless of these settings.

## When it stops working

Sessions expire at around 90 days. Run `login` again, or paste a fresh cookie.

If you are on a custom domain and get a 403 mentioning `error code: 1010`, that is Cloudflare. Set `SUBSTACK_PUBLICATION_URL` to the canonical `*.substack.com` host instead.

## Links

- [Substack](https://substack.com)
- [Repository](https://github.com/thenavidm/substack-mcp)
