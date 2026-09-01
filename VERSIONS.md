# Substack MCP Versions

| Component | Version | Last Updated |
|-----------|---------|--------------|
| substack-mcp | 2.1.0 | 2026-09-01 |

---

## 2.1.0

Brought in line with the repo standard, which it was not following.

`openWorldHint` is now true on every tool. Every call in this server reaches
Substack, reads included, so the old conditional was wrong. `idempotentHint` now
marks reversible writes as idempotent and only irreversible ones as not.

The README follows the standard section order: what you can ask it, quick
install, setup, connect your client, check it worked, then the rest, with the FAQ
before the About block. Installing the package no longer appears to need
credentials you have not been told how to get yet.

Added `AGENTS.md` and `CLAUDE.md` for agents working on the repo, which were
missing. The LICENSE holder is corrected. Every internal anchor and external link
in the README was checked and four broken ones fixed.

---

## 2.0.3

The repository moved to `navidmoazzez/substack-mcp`. Package links updated to match. No code change.

---

## 2.0.2

`--version` and `--help` reported 2.0.0 on a 2.0.1 package, because the version
was written in the source as well as in package.json and only one of them was
bumped. It is now read from package.json, and the check that keeps the tool
counts honest checks the version too.

---

## 2.0.1

Metadata only. The package description and keywords now match the house format, and the repo description and topics with them. No code change.

---

## 2.0.0

A rewrite. TypeScript, 65 tools, and a correctness fix that mattered.

### The fix

1.x sent `draft_body` as raw HTML. Substack's `draft_body` is a JSON ProseMirror document, and the API accepts HTML with a 200 and then renders the post with the tags visible as literal text. There was no error to catch.

1.x also never sent `draft_bylines`, which Substack requires on a draft.

Both are fixed, and a test exists for each so neither can come back.

### Tools

26 to 65.

New: `get_draft`, `unschedule_draft`, `list_scheduled_posts`, `set_draft_body`, `preview_draft_body`, `get_sections`, `get_post_by_id`, `rank_posts`, `publish_note_with_link`, `export_subscribers`, `get_analytics`, `list_publication_tags`, `create_tag`, `get_post_tags`, `add_tag_to_post`, `remove_tag_from_post`, `get_post_comments`, `comment_on_post`, `delete_comment`, `list_subscriptions`, `list_reader_posts`, `get_reader_post`, `get_reader_feed`, `get_profile_feed`, `get_comment_thread`, `restack_note`, `get_publication_settings`, `update_publication_settings`, `get_user_profile`, `list_templates`, `create_template`, `delete_template`, `create_draft_from_template`, `research_creator_posts`, `research_creator_notes`, `compare_publications`, `upload_image`, `list_contributors`, `get_import_status`.

`list_subscribers` now filters on all 48 columns with 18 operators, instead of taking only an offset and a limit.

### Content

Markdown in, markdown back out. `get_draft` returns an editable body, so changing one sentence no longer means reconstructing the document.

A line containing only a YouTube, X, Spotify or Vimeo URL becomes a real embedded player. `<paywall>` on its own line marks the paid boundary. Nested lists survive to any depth with ordered and unordered mixed. A markdown table is preserved verbatim in a code block rather than being flattened.

Documents are validated before they are sent, so an unknown node is an error here rather than a post that renders wrong on Substack.

### Safety

Irreversible actions need `confirm: true`: publishing, deleting anything, publishing a Note, commenting, restacking. `SUBSTACK_READ_ONLY=1` hides and refuses every write. `SUBSTACK_ALLOW_DESTRUCTIVE=0` keeps drafting but blocks publishing and deleting. `SUBSTACK_AUDIT_LOG` records every attempted write.

Every tool sets all four MCP annotations explicitly, because an omitted `destructiveHint` defaults to true.

Tools that return other people's text say so in the response, and the server's instructions tell the model to treat it as data.

### Reliability

A 30 second request deadline, since Node applies none. Exponential backoff with jitter on 429 and 5xx, honouring `Retry-After`. A 350ms floor between requests so a loop does not get the account rate limited. Typed errors, so a message names the fix instead of saying "Substack API error". Cloudflare's 1010 block on custom domains is recognized and explained.

### Setup

`substack-mcp login` stores a session encrypted with AES-256-GCM, machine-bound, `0600`. Three ways to capture it: paste (default, instant), `--playwriter` (reads the Chrome you already have open), `--playwright` (launches its own, slowest). Browser drivers are optional and lazily imported, so the server never loads them.

`substack-mcp doctor` checks credentials, config, connectivity and byline resolution.

`SUBSTACK_USER_ID` is now optional. It is resolved and cached automatically.

### Transports

stdio by default. `--http` serves streamable HTTP with Origin validation and optional bearer auth, for running it somewhere always on so scheduled Notes fire.

### Also

Two MCP resources and four prompts. Multi-publication support, with a `publication` argument on every publication-scoped tool. 69 tests.

### Verified against a live publication

Every read-only tool was run against a real Substack account rather than checked by reading code. That found four bugs, all fixed here: `get_dashboard_summary` and `get_subscriber_count` both failed because the dashboard endpoint needs a date range and the old subscriber-count endpoint is gone, `list_scheduled_posts` sorted by a field the endpoint rejects, and `search_publications` silently returned nothing because it answers 200 with an empty list when unauthenticated.

The write path was proven too. A draft created from markdown stores as a real ProseMirror document with a working YouTube embed and a paywall, reads back as markdown, and survives an edit.

### Breaking changes from 1.x

- `list_subscribers` takes `filters` instead of `filter`.
- `get_draft` returns markdown by default rather than raw ProseMirror.
- `delete_draft`, `publish_draft`, `delete_note` now require `confirm: true`.
- The package ships from `dist/`. `index.mjs` is gone.

---

## 1.0.0

First release. 26 tools over Substack's internal API, as a single `index.mjs`.
