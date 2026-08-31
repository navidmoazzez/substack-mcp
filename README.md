# Substack MCP

Give any AI agent full control of your Substack. Write and publish posts, work your subscriber list, read your analytics, and study what is working for other writers, from Claude, Cursor, or any MCP client.

65 tools. No API key, because Substack does not have a public API. Your session stays on your machine.

Built by [Navid Moazzez](https://navid.me).

```
You: which of my posts actually converted free readers to paid?

Claude: Ranking your last 40 posts by paid signups.

  1. "The part nobody tells you about pricing"    18 paid
  2. "I audited 60 newsletters. Here is the gap"  11 paid
  3. "Why your welcome email is costing you"       9 paid

  All three are teardowns with a specific number in the title.
  Your five worst converters are all essays with abstract titles.
```

## Contents

| | Section | |
|---|---|---|
| | [What makes this different](#what-makes-this-different) | Why pick this one |
| 1 | [What you can ask it](#1-what-you-can-ask-it) | Real prompts, not features |
| 2 | [Install](#2-install) | Every client, copy and paste |
| 3 | [Connect your account](#3-connect-your-account) | Three ways, fastest first |
| 4 | [Tools](#4-tools) | All 65, with arguments |
| 5 | [Writing safely](#5-writing-safely) | Why publishing asks twice |
| 6 | [Writing posts](#6-writing-posts) | Markdown, embeds, paywalls |
| 7 | [Several publications](#7-several-publications) | One login, many Substacks |
| 8 | [How it works](#8-how-it-works) | Architecture |
| 9 | [Your data](#9-your-data) | What is stored and where |
| 10 | [Risks](#10-risks) | Read this before you install |
| 11 | [Troubleshooting](#11-troubleshooting) | When something breaks |
| 12 | [Build from source](#12-build-from-source) | Contributing |

---

## What makes this different

Other Substack MCP servers cover the basics: list your drafts, create one, read your subscriber count. This one is built around the things that decide whether a post actually comes out right, and every claim below was checked against a live publication rather than assumed.

| | |
|---|---|
| **Posts render correctly** | `draft_body` is a ProseMirror document, not HTML. Send HTML and Substack returns 200, then publishes your post with the tags visible as text. There is no error to catch, which is why this is the most common way a Substack integration gets it wrong. |
| **Markdown both ways** | Markdown in, and markdown back out. Read a draft, change one sentence, send it back. Servers that only convert one way hand you raw ProseMirror JSON and leave you rebuilding the whole document to fix a typo. |
| **Links become embeds** | A line holding only a YouTube, X, Spotify or Vimeo URL becomes a real player. Substack does that conversion in its editor, so it never happens through the API unless you do it yourself. |
| **Paywalls from markdown** | `<paywall>` on its own line marks the paid split. |
| **Subscribers, properly** | Filter on all 48 columns with 18 operators, and export the engagement metrics the list endpoint will only filter on and never return. |
| **Analytics, all of it** | 16 publication reports, including which other Substacks share your readers. |
| **More than one publication** | One login often owns several. Every tool takes a `publication` argument. |
| **Notes can be scheduled** | Substack schedules posts but not Notes, so the queue lives here. |
| **Research other writers** | Their posts and Notes with engagement attached, so you can rank by what worked. Custom domains resolve automatically. |
| **Irreversible things ask first** | Publishing emails your whole list and cannot be undone. Those tools refuse to run without an explicit confirmation, and `SUBSTACK_READ_ONLY=1` removes them entirely. |
| **Built to keep working** | A real request deadline, backoff on rate limits, typed errors that name the fix, and every MCP annotation set explicitly. |

---

## 1. What you can ask it

- Draft this week's post from my notes, in the voice of my last five.
- Which of my posts got the most paid conversions, and what do they have in common?
- How many subscribers have not opened anything in 90 days?
- Pull every Note that mentions pricing from the three writers I compete with.
- Add a paywall after the third section of that draft.
- Schedule this Note for 9am Tuesday.
- Compare my open rate to what it was six months ago.
- Read my inbox and tell me what my corner of Substack is arguing about this week.
- Turn my last three posts into a guide, and put the YouTube version at the top.

The last one is the point. It reads your existing posts, writes a new draft in your format, and embeds the video as a real player rather than a blue link, because it speaks Substack's document format rather than pasting HTML at it.

---

## 2. Install

Node 20 or newer. Nothing else.

> Not released yet. The `npx` commands below work once `v2.0.0` is tagged and
> the release workflow publishes to npm. Until then, install from source with
> [section 13](#13-build-from-source) and point your client at `node
> /path/to/substack-mcp/dist/index.js`.

### Claude Code

```bash
claude mcp add substack -- npx -y @thenavidm/substack-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

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

### Cursor, Windsurf, VS Code, Zed, Cline

Same block, in that client's MCP config file. Any client that speaks MCP over stdio works.

### Docker

```bash
docker build -t substack-mcp .
docker run -i --rm \
  -e SUBSTACK_PUBLICATION_URL=example.substack.com \
  -e SUBSTACK_SESSION_TOKEN=your-token \
  substack-mcp
```

Once a version is tagged, `ghcr.io/thenavidm/substack-mcp:latest` is published
and can be used instead of building.

### Self-hosting

Only one thing needs this: `schedule_note` publishes from the machine the server
runs on, so a Note queued for 9am fires at 9am only if that machine is awake.
Everything else works fine on a laptop.

If you want scheduling that does not depend on yours, run it somewhere always on:

```bash
substack-mcp --http --port=8788
```

It binds to `127.0.0.1` and serves `/health`. To reach it from elsewhere, set
`SUBSTACK_MCP_HOST=0.0.0.0` and `SUBSTACK_MCP_TOKEN` to a random string, put it
behind TLS, and add any extra origins to `SUBSTACK_MCP_ALLOWED_ORIGINS`. Bind
beyond localhost without a token and it warns you, because anyone who reaches
that port controls your Substack.

### Check it worked

```bash
npx @thenavidm/substack-mcp doctor
```

`doctor` runs the checks in order and names the actual problem, rather than leaving you to guess which of six things is wrong.

---

## 3. Connect your account

Substack has no public API and no OAuth. Everything here runs on your browser session cookie, exactly like the Substack tab you already have open.

**Treat that cookie like a password.** It is full access to your account. Never paste it into an issue, a gist, or a chat with anyone.

### Option A: paste the cookie (fastest, recommended)

```bash
npx @thenavidm/substack-mcp login
```

It asks for your publication URL and the cookie, resolves your user id, and stores the result encrypted. Then you can leave the `env` block out of your client config entirely.

To find the cookie:

1. Open your publication and sign in.
2. DevTools, then Application, then Cookies.
3. Copy the value of `connect.sid`. It is long and starts with `s%3A`.

Turn off ad blockers first. Some of them strip the cookie from that panel.

### Option B: read it from the Chrome you already have open

```bash
npx @thenavidm/substack-mcp login --playwriter
```

Uses [Playwriter](https://playwriter.dev) to read the cookie out of your running Chrome, where you are already signed in. No browser launch, no sign-in, no CAPTCHA. Requires Playwriter and its extension.

### Option C: launch a browser and sign in

```bash
npm i -g playwright && npx playwright install chromium
npx @thenavidm/substack-mcp login --playwright
```

A browser opens and waits up to ten minutes for you to sign in, CAPTCHA and emailed link included. This is much the slowest option, and the only one that works on a machine with no Chrome, or in CI.

Playwright is not bundled. It is large, it is only ever used by this one command, and the server never loads it, so your tool calls are not slower for it existing.

### Or just use environment variables

Nothing above is required. Set `SUBSTACK_PUBLICATION_URL` and `SUBSTACK_SESSION_TOKEN` and you are done. `SUBSTACK_USER_ID` is optional and looked up automatically when absent.

### When it expires

Sessions do expire, commonly reported at around 90 days, though I have not measured it. When calls start failing with an authentication error, run `login` again, or paste a fresh cookie. `doctor` warns you once a stored session passes 75 days.

---

## 4. Tools

65 tools. Every one declares whether it reads, writes, or does something that cannot be undone, so your client can show you the difference before anything runs.

Every publication-scoped tool takes an optional `publication` argument to pick which connected Substack it acts on. See [section 7](#7-several-publications).

### Drafts

| Tool | | What it does |
|---|---|---|
| `create_draft` | write | Create a draft from markdown. Private until you publish |
| `update_draft` | write | Change any field. Only what you pass is touched |
| `get_draft` | read | Read a draft, body returned as **markdown you can edit** |
| `list_drafts` | read | Unpublished drafts, most recently edited first |
| `delete_draft` | **destructive** | Permanent, no trash. Needs `confirm` |
| `publish_draft` | **destructive** | Publishes and emails your list. Needs `confirm` |
| `schedule_draft` | write | Schedule on Substack's side, so it fires without you |
| `unschedule_draft` | write | Back to a plain draft |
| `list_scheduled_posts` | read | What is queued, soonest first |
| `set_draft_body` | write | Replace the body with a document you build node by node |
| `preview_draft_body` | read | See what a body will render as, changing nothing |
| `get_sections` | read | Section ids, which `create_draft` needs |

`create_draft` takes `title`, `subtitle`, `body`, `body_format`, `section_id`, `audience` (`everyone`, `only_free`, `only_paid`, `founding`), `type` (`newsletter`, `podcast`, `thread`), `cover_image`, and three SEO fields.

`get_draft` takes `body_format` of `markdown`, `prosemirror`, or `both`. Markdown is the default, because it is what you can actually edit and send back.

### Posts

| Tool | | What it does |
|---|---|---|
| `list_posts` | read | Published posts, newest first |
| `get_post` | read | Read a post by slug, from **any** publication |
| `get_post_by_id` | read | Same, by numeric id |
| `search_posts` | read | Search your own posts by keyword |
| `get_post_stats` | read | Opens, clicks, views, signups, reactions for one post |
| `rank_posts` | read | Rank posts by any metric, to find what worked |

### Notes

Notes have no draft state on Substack. Writing one publishes it, immediately and publicly.

| Tool | | What it does |
|---|---|---|
| `publish_note` | **destructive** | Live and public at once. Needs `confirm` |
| `publish_note_with_link` | **destructive** | With a link preview card. Needs `confirm` |
| `schedule_note` | write | Queue one for later. See the caveat below |
| `list_scheduled_notes` | read | What is queued, published, failed or cancelled |
| `cancel_scheduled_note` | write | Cancel before it fires |
| `list_notes` | read | Notes you have published |
| `delete_note` | **destructive** | Permanent. Needs `confirm` |

Substack does not schedule Notes, so the queue is kept locally and this server publishes each one when it comes due. **That only happens while the server is running.** A Note set for 9am fires at 9am if your machine is awake with your client open, and otherwise on the next start after that time, flagged as published late. Nothing is ever dropped. For scheduling that does not depend on your laptop, see [self-hosting](#self-hosting).

### Subscribers

| Tool | | What it does |
|---|---|---|
| `list_subscribers` | read | Filter on 48 columns with 18 operators |
| `export_subscribers` | read | The only way to actually **read** engagement metrics |
| `get_subscriber_count` | read | Totals, free and paid |
| `add_subscriber` | write | Add an address to the list |

`list_subscribers` takes `filters` as `{column, operator, value}` combined with AND, plus `search`, `sort_by`, `sort_direction`, `limit` and `offset`.

Which operators apply depends on the column's type:

| Type | Operators |
|---|---|
| `Int` | `is` `is_not` `gt` `gte` `lt` `lte` |
| `String` | `is` `is_not` `is_any_of` `contains` `starts_with` `ends_with` `includes_none` |
| `DateTime` | `is_on` `is_after` `is_on_or_after` `is_before` `is_on_or_before` |
| `Array` (`tag_ids`, `emails_enabled`) | `includes_any` `includes_all` `includes_none` |
| `subscription_type`, `group_membership` | `is` `is_not` `is_any_of` |

The 48 columns cover identity (name, email, country, state, group), subscription (type, dates, revenue, Stripe plan, attribution), email engagement (opens over 7d/30d/6mo, links clicked, sections) and site engagement (views, comments, shares, days active, activity rating). The full list with types reaches your client in the tool's schema, so the model does not have to guess.

There is no OR and no nesting. That is a limit of Substack's endpoint. Anything needing OR has to be issued as separate calls.

Two things about `export_subscribers`, both verified against the live API:

- `tag_ids` and `group_membership` cannot be exported. Substack drops them without failing, so they come back in `missing_columns`. Asking for all 48 returns 46.
- Values arrive display-formatted. Revenue is `"$50.00"` here and the number `50` through `list_subscribers`.

### Analytics

| Tool | | What it does |
|---|---|---|
| `get_analytics` | read | One of 16 reports, listed below |
| `get_dashboard_summary` | read | The headline numbers |
| `get_email_stats` | read | Delivery, opens, clicks |
| `get_revenue_summary` | read | Plans, prices, what each brings in |

`get_analytics` reports: `unsubscribes`, `unsubscribes_timeseries`, `retention`, `retention_summary`, `referrals_leaderboard`, `referrals_summary`, `audience_overlap`, `audience_locations`, `subscriber_notes`, `paid_subscriber_growth`, `arr_timeseries`, `followers_timeseries`, `subscribers_timeseries`, `growth_sources`, `growth_events`, `network_attribution`.

`audience_overlap` is the interesting one. It names the other Substacks whose readers overlap yours, with percentages, which is the list of people worth doing a swap with.

### Tags and comments

| Tool | | What it does |
|---|---|---|
| `list_publication_tags` | read | Every tag on the publication |
| `create_tag` | write | Create one |
| `get_post_tags` | read | Tags on one post |
| `add_tag_to_post` | write | Tag a post |
| `remove_tag_from_post` | **destructive** | Untag. Needs `confirm` |
| `get_post_comments` | read | Comments on your post |
| `comment_on_post` | **destructive** | Public immediately. Needs `confirm` |
| `delete_comment` | **destructive** | Permanent. Needs `confirm` |

### Reading Substack

| Tool | | What it does |
|---|---|---|
| `list_subscriptions` | read | What this account subscribes to |
| `list_reader_posts` | read | Your inbox |
| `get_reader_post` | read | Any post you have access to, including paid ones |
| `get_reader_feed` | read | The Notes timeline |
| `get_profile_feed` | read | Everything one account has published |
| `get_comment_thread` | read | A Note and its replies |
| `restack_note` | **destructive** | Republishes to your followers. Needs `confirm` |

### Publication

| Tool | | What it does |
|---|---|---|
| `get_publication_settings` | read | Every setting on the settings page |
| `update_publication_settings` | write | Change them, including theme colours |
| `get_user_profile` | read | Which account is connected |
| `search_publications` | read | Find Substacks by name or topic. No auth needed |
| `get_publication_info` | read | Public details of any publication |
| `list_contributors` | read | Who can write on it, with byline ids |
| `get_import_status` | read | Result of the last subscriber import |

`update_publication_settings` names `accent_color` and `color_links` explicitly, because Substack stores them under opaque theme variable names, and `color_links` being off is the usual reason links render nearly invisible on a dark theme.

### Templates

| Tool | | What it does |
|---|---|---|
| `list_templates` | read | Your saved post templates |
| `create_template` | write | Save one |
| `delete_template` | **destructive** | Permanent. Needs `confirm` |
| `create_draft_from_template` | write | Start a draft from one, formatting exact |

### Research

| Tool | | What it does |
|---|---|---|
| `research_creator_posts` | read | Another writer's posts **with engagement numbers** |
| `research_creator_notes` | read | Their Notes, ranked by likes or restacks |
| `compare_publications` | read | Up to 10 publications ranked together |
| `scrape_post` | read | Any public post from its URL |

`compare_publications` scores by likes, plus comments times two, plus restacks times three, because a comment and a restack both cost more effort than a like.

### Images

| Tool | | What it does |
|---|---|---|
| `upload_image` | write | Upload from a URL or a local file, get a CDN URL back |

Takes exactly one of `url` or `path`. PNG, JPEG, GIF and WebP up to 10MB. The type is checked from the file's contents, not its extension.

### Resources and prompts

Beyond tools, the server exposes two MCP resources (`substack://publication` and `substack://connected`) so a client can load your publication's context without spending a tool call, and four prompts: **Draft a post from an idea**, **Find what worked**, **Study another writer**, and **Find lapsed subscribers**.

---

## 5. Writing safely

Two positions are common and both are wrong. Ship `publish` and `delete` unguarded, and one mis-parsed instruction emails your entire list. Remove them and call that safety, and you have not made anything safer, you have moved the work back to the human.

The actual hazard is narrow and worth naming. `publish_draft` with `send: true` emails every subscriber you have and **there is no unsend**. `delete_draft` has no undo. `publish_note` and `comment_on_post` are public the instant they run. None of these is dangerous when a person meant it. All of them are dangerous one plausible misreading of "tidy up my drafts" away.

So everything works, and the irreversible things need an explicit `confirm: true`:

```
delete_draft is irreversible: permanently delete draft 4821.
Nothing has been changed. Re-run with confirm: true if that is what you want.
```

A careless call trips over that. An intentional one clears it in a single retry.

### Turning writes off entirely

```json
"env": { "SUBSTACK_READ_ONLY": "1" }
```

Drops the server to its 41 read tools. Write tools are not merely refused, they are not advertised, so the model never tries.

`SUBSTACK_ALLOW_DESTRUCTIVE=0` is the middle setting: drafting and tagging still work, publishing and deleting do not.

### Annotations

Every tool sets `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` explicitly. MCP defaults `destructiveHint` and `openWorldHint` to **true** when omitted, so a read tool left unannotated shows up in a client as dangerous, which trains people to ignore the warnings that matter.

### An audit log

```json
"env": { "SUBSTACK_AUDIT_LOG": "/Users/you/.substack-mcp/audit.log" }
```

Append-only, one JSON line per attempted write, allowed or blocked.

### Prompt injection

Several tools return text other people wrote: comments, your reader feed, another writer's posts. An agent that can read that text and also publish is exposed to instructions hidden inside it. Every one of those tools says so in its own response, and the server's instructions tell the model to treat that text as data. Combined with confirmation on every public action, an injected "publish this now" cannot fire on its own.

---

## 6. Writing posts

`draft_body` is **not HTML**. It is a JSON ProseMirror document. This is the single most common way a Substack integration goes wrong: send HTML and the API returns 200, then the post renders with the tags visible as literal text. There is no error. You find out by looking at the published post.

This server converts markdown, HTML, or a ready-made document into the real format, and detects which you sent.

### Markdown

Headings, bold, italic, inline code, strikethrough, links, images, nested lists to any depth with ordered and unordered mixed, fenced code blocks with a language, blockquotes and horizontal rules.

### Embeds

A line containing only a YouTube, X, Spotify or Vimeo URL becomes a **real embedded player**:

```markdown
Here is the walkthrough.

https://www.youtube.com/watch?v=dQw4w9WgXcQ

The transcript is below.
```

Substack's editor does this client-side, so it never happens for anything written through the API. Doing it here is why a draft from this server looks like one you made by hand. Put the URL inside a sentence and it stays an ordinary link.

`x.com` links are rewritten to `twitter.com`, because Substack's embed only resolves the latter.

### Paywalls

```markdown
The free part everyone sees.

<paywall>

The part only paying subscribers get.
```

### Tables

Substack's document format has no table node, so a table cannot be rendered natively. Rather than mangle the pipes into a paragraph, a markdown table is preserved verbatim in a code block. The content survives and you can reformat it in the editor.

### Reading it back

`get_draft` returns markdown by default. Edit one sentence, send it back to `update_draft`, and the rest of the formatting survives.

`preview_draft_body` shows exactly what a body will produce, including how many embeds were created and whether the paywall registered, without touching anything.

---

## 7. Several publications

One Substack login often owns more than one publication.

```json
"env": {
  "SUBSTACK_PUBLICATIONS": "[{\"publication_url\":\"one.substack.com\",\"session_token\":\"...\"},{\"publication_url\":\"two.substack.com\",\"session_token\":\"...\"}]"
}
```

Every publication-scoped tool takes an optional `publication` argument, matched loosely against the hostname, so `"two"` finds `two.substack.com`. Leave it out and the first one is used.

Ask for a publication that is not connected and the error names the ones that are, rather than failing silently against the wrong Substack.

---

## 8. How it works

```
your MCP client
      |  stdio (or HTTP)
      v
  substack-mcp
      |
      +-- write guard        confirm, read-only, audit log
      +-- content pipeline   markdown/HTML <-> ProseMirror, embeds
      +-- one HTTP client    timeout, retry, backoff, spacing
      |
      v
Substack's own JSON endpoints, signed with your session cookie
```

Every request goes through one client, so an upstream change is fixed in one file. That client adds four things a bare `fetch` does not:

**A real deadline.** Node applies no request timeout, only a 10 second connect timeout. A host that accepts the connection and then goes quiet would otherwise hang a tool call forever. Default 30 seconds, set with `SUBSTACK_REQUEST_TIMEOUT_MS`.

**Retries that help.** 429 and 5xx get exponential backoff with jitter, honouring `Retry-After`. Nothing else is retried, because nothing else resolves by waiting.

**Request spacing.** A floor of 350ms between requests, serialised through a queue, so a model looping over 200 posts does not get your account rate limited. `SUBSTACK_MIN_REQUEST_INTERVAL_MS`.

**A browser identity.** The client sends a browser User-Agent, Referer and Origin, because some publications sit behind Cloudflare, which blocks unrecognised clients. The error mapper recognises a Cloudflare block hiding inside a 403 and tells you to use the canonical host.

Errors map to typed classes, so the message names the fix rather than saying "Substack API error":

| Class | Status | Cause |
|---|---|---|
| `AuthenticationError` | 401/403 | Expired session, or a Cloudflare block |
| `RateLimitError` | 429 | Too many requests, after retries |
| `ValidationError` | 400 | Bad arguments |
| `NotFoundError` | 404 | No such draft, post or note |
| `ServerError` | 5xx | Substack's problem |
| `TimeoutError` | 408 | Our own deadline, no response arrived |

---

## 9. Your data

Nothing is sent anywhere except Substack. There is no telemetry, no analytics, and no third-party service in the path.

Two files, both in `~/.substack-mcp` (`SUBSTACK_MCP_HOME` moves it):

**`session.json`**, only if you ran `login`. Written `0600`, encrypted with AES-256-GCM under a key derived from this OS account and this machine, which is never stored.

Be clear about what that buys. A copied file is useless elsewhere, and a casual disk or backup read sees ciphertext. It is machine-binding and obfuscation, **not** a secret vault. Code running as you on this machine can re-derive the key, which is exactly the exposure of the environment-variable path too. If you would rather your client held the secret, use env vars.

**`scheduled-notes.json`**, the local queue for `schedule_note`. Plain JSON, `0600`, containing the text of Notes you have not published yet.

Your posts, drafts and subscribers are never copied locally. Every read goes to Substack live.

---

## 10. Risks

**This uses an undocumented API.** Substack publishes no REST API and no OAuth. These are the endpoints its own web app calls. They can change without notice, and when they do, tools break until the fix ships.

**Your session cookie is full account access.** Anyone who gets it can post as you, read your subscribers, and change your billing. It is exactly as sensitive as your password. Never paste it into an issue.

**An agent with publish rights can email your entire list.** The confirmation gate makes that hard to do by accident. It does not make it impossible for a determined bad instruction. If you are pointing an autonomous agent at this, run it with `SUBSTACK_READ_ONLY=1`.

**Automated subscriber additions are how publications get marked as spam.** `add_subscriber` exists for people who asked to be added. Importing anyone else is your problem, not Substack's.

**Terms of service.** Automating your own account through its own web endpoints is not something Substack documents or blesses. I am not aware of anyone being banned for it, but I cannot promise that, and neither can anyone else shipping a tool like this.

---

## 11. Troubleshooting

Run `npx @thenavidm/substack-mcp doctor` first. It checks credentials, config, connectivity and byline resolution, and names what is wrong.

**"Substack rejected the session"** Your cookie expired. Get a fresh `connect.sid`, or run `login` again.

**Calls fail on a custom domain** A publication served on its own domain does not answer the API there. The request redirects and ends in a 404. Set `SUBSTACK_PUBLICATION_URL` to the canonical `*.substack.com` host instead, which is served directly. The research tools retry the canonical host automatically; everything else needs it configured.

Some custom domains sit behind Cloudflare, which can answer 403 with `error code: 1010`. That is the same fix.

**Post renders with visible HTML tags** You are on an older version, or something else wrote that draft. This server never sends HTML as `draft_body`. Check with `preview_draft_body`.

**`create_draft` fails on the byline** Substack requires a byline, and it is your numeric user id. Normally resolved automatically. If that fails, set `SUBSTACK_USER_ID`. `doctor` tells you which.

**A scheduled Note did not fire** The server was not running at the time. It publishes on the next start, marked `published_late`. Check with `list_scheduled_notes`, and see the next section.

**Tools missing from the list** `SUBSTACK_READ_ONLY` is set. The 24 write tools are hidden by design.

**Nothing happens at all** Check your client's MCP logs. On a bad config the server still starts and reports the problem per tool call, rather than failing silently at boot.

---

## 12. Build from source

```bash
git clone https://github.com/thenavidm/substack-mcp.git
cd substack-mcp
npm install
npm run build
npm test
```

```
src/
  api/         one HTTP client, typed errors, identity resolution
  auth/        encrypted session store, the login command
  content/     markdown <-> ProseMirror, embeds, images
  subscribers/ the 48-column filter model
  tools/       65 tools, grouped by subject
  transport/   stdio and HTTP
  safety.ts    the write guard
  scheduler.ts the local Note queue
```

Adding a tool means one `defineTool` call. Guarding, annotations, error handling and publication selection are applied by the registration kit, so a tool module only describes what it does.

Because this rides an undocumented API, **the most valuable contribution is a fix when an endpoint changes.** If a tool stops working, open an issue with the tool name and the error. Never include your cookie.

---

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `SUBSTACK_PUBLICATION_URL` | | Your publication, e.g. `example.substack.com` |
| `SUBSTACK_SESSION_TOKEN` | | The `connect.sid` cookie value |
| `SUBSTACK_USER_ID` | resolved | Your numeric user id |
| `SUBSTACK_PUBLICATIONS` | | JSON array, for several publications |
| `SUBSTACK_READ_ONLY` | `0` | Disable every write |
| `SUBSTACK_ALLOW_DESTRUCTIVE` | `1` | Allow publish and delete |
| `SUBSTACK_AUDIT_LOG` | | Append-only log of attempted writes |
| `SUBSTACK_REQUEST_TIMEOUT_MS` | `30000` | Per-request deadline |
| `SUBSTACK_MIN_REQUEST_INTERVAL_MS` | `350` | Minimum spacing between requests |
| `SUBSTACK_MAX_RETRIES` | `3` | Retries on 429 and 5xx |
| `SUBSTACK_USER_AGENT` | Chrome | Override the browser signature |
| `SUBSTACK_MCP_HOME` | `~/.substack-mcp` | Where session and queue live |
| `SUBSTACK_MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `SUBSTACK_MCP_PORT` | `8788` | HTTP port |
| `SUBSTACK_MCP_TOKEN` | | Bearer token for HTTP |
| `SUBSTACK_MCP_ALLOWED_ORIGINS` | | Extra origins beyond localhost |

## Versions

See [VERSIONS.md](VERSIONS.md).

## About the author

Navid Moazzez is a leading AI business strategist and the host of the [AI Creator Summit](https://summits.navid.me/ai-creator), watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Substack MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me)
- Store: [navid.bio](https://navid.bio)
- AI OS Starter Kit: [aios.guide](https://aios.guide)
- AI OS Workshop: [aiosworkshop.com](https://aiosworkshop.com)
- AI Creator Summit: [summits.navid.me/ai-creator](https://summits.navid.me/ai-creator)
- AI Tools Library: [aitoolslibrary.io](https://aitoolslibrary.io)
- Video Gear Guide: [videogear.guide](https://videogear.guide)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

## Dependencies

| Library | Licence | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

[Playwright](https://github.com/microsoft/playwright) is an optional peer dependency, used only by `login --playwright` and never loaded by the server.

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Substack Inc.

---

© 2026 NM Media. Made with ❤️ by [Navid Moazzez](https://navid.me).
