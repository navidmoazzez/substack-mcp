# Audit of the two existing Substack MCP servers

Read from source on 2026-08-31, not from the READMEs and not from memory.

- `marcomoauro/substack-mcp` — JavaScript, 27 tools, 5,175 lines across `src/` excluding specs
- `conorbronsdon/substack-mcp` — TypeScript, 14 tools, 4,085 lines across `src/` including tests

This file exists so the reasons behind our design decisions do not get lost.
Every claim below was checked in their code and carries a file reference.

## Why this project exists

Not because either of them is bad. Both are careful in places ours borrowed
from. The gap is that each solves one half of the problem and neither solves
the half that actually breaks: getting a well-formatted post into Substack and
back out again.

## Their structure

```
marcomoauro
  src/tools/*.js                    27 tools, one file each, each with a .spec.js
  src/api/substack/SubstackApi.js   every endpoint
  src/api/substack/document.js      a zod schema for Substack's document format
  src/api/substack/SubscriberQuery.js  the 48-column filter model

conorbronsdon
  src/server.ts                     524   all 14 tools inline
  src/utils/markdown-to-prosemirror.ts  444
  src/api/client.ts                 443
  src/auth/session-store.ts         159   AES-256-GCM, machine-bound
  src/login.ts                      149   Playwright browser login
  src/annotations.ts                120
  src/__tests__/                    ~1,500
```

## Content: the part that matters most

Substack's `draft_body` is a JSON ProseMirror document. Send HTML and the API
answers 200, then the post renders with the tags visible as literal text. There
is no error. This is the single highest-value thing a Substack integration has
to get right.

### marcomoauro: a schema, but no markdown

`document.js` defines the document as a zod schema and validates against it,
which is genuinely good: an unknown node is refused before it reaches Substack
rather than silently mangling a post. The node vocabulary is published to the
model in the `set_post_body` description, so it does not have to guess.

The node set is `paragraph`, `heading`, `blockquote`, `bullet_list`,
`ordered_list`, `list_item`, `code_block`, `horizontal_rule`, `image2`,
`captionedImage`, `youtube2`, `button`, `paywall`.

But markdown is not interpreted. Their README says so plainly, and
`document.js:196` records the reasoning: a Markdown contract they considered
omitted the paywall, so they dropped markdown rather than ship a lossy one.
The consequence is that the caller has to hand-build a JSON document for
anything with structure, so `## Heading` arrives as literal text.

`youtube2` exists as a node the caller may emit. Nothing detects a pasted
YouTube URL and turns it into one. There is no `twitter2`, `spotify2` or
`vimeo` node at all.

### conorbronsdon: markdown, but a narrower schema

`markdown-to-prosemirror.ts` is a real 444-line converter with its own 396-line
test file. It handles paragraphs, headings, bold, italic, inline code, links,
images, nested lists to arbitrary depth, code blocks with a language,
blockquotes and horizontal rules. A GFM table is preserved verbatim in a code
block rather than mangled, which is the right call and one we copied.

What it does not have: no paywall (`grep -c paywall` on that file returns 0),
and no embed nodes of any kind (`grep -ci "youtube\|twitter2\|spotify"` across
`src/` returns nothing).

### Neither converts back

`src/utils/` in conorbronsdon holds three files: `errors.ts`, `image.ts` and
`markdown-to-prosemirror.ts`. There is no reverse.

`server.ts:169` returns `body: draft.draft_body`, the raw ProseMirror JSON
string. marcomoauro's `get_draft.js:49` returns the whole draft object, which
carries the same raw string.

So in both, editing an existing draft means a model reads a wall of JSON,
reconstructs the entire document to change one sentence, and usually flattens
the formatting doing it.

**What we did.** Markdown, HTML and a ready-made document all convert in, with
the format sniffed rather than declared. A line holding only a YouTube, X,
Spotify or Vimeo URL becomes a real embed. `<paywall>` on its own line marks the
boundary. And `docToMarkdown` converts back, so `get_draft` returns something
editable and `update_draft` parses it straight back.

## Safety

The two take opposite positions and neither is right.

### conorbronsdon removes the dangerous tools

No publish, no delete, no schedule for long-form posts, stated loudly and
consistently. Notes are the documented exception, because they have no draft
state, and the README says so rather than hiding it.

Annotations are set explicitly in `annotations.ts`, with the reasoning written
down: an omitted `destructiveHint` or `openWorldHint` defaults to `true`. That
is a real point and we adopted it.

The cost is capability. You cannot publish, which means the tool stops at the
last step of the job.

### marcomoauro ships everything unguarded

`delete_draft` and `publish_draft` take no confirmation argument. Grepping
`src/` returns no `readOnlyHint`, no `destructiveHint`, no `READ_ONLY` and no
`confirm`. `publish_draft` sends `{send}` straight through, so a mis-parsed
instruction emails the whole list with nothing in the way.

**What we did.** Everything works, and the irreversible operations require an
explicit `confirm: true`. `SUBSTACK_READ_ONLY=1` hides and refuses every write.
`SUBSTACK_ALLOW_DESTRUCTIVE=0` sits between. An audit log records attempts.
More capable than conorbronsdon and safer than marcomoauro, rather than picking
one end.

## Reliability

`SubstackApi.js` has no `AbortController` and no timeout. Node applies no
request timeout of its own, only a 10-second connect timeout, so a host that
accepts the connection and then goes quiet hangs the tool call indefinitely.

conorbronsdon fixed exactly this: `client.ts` applies a 30-second deadline and
their README explains the reasoning. We took both the fix and the reasoning,
and added retry with backoff on 429 and 5xx, plus a floor between requests so a
model looping over 200 posts does not get the account rate limited.

Their typed error hierarchy is also good and we adopted the shape, extending it
with the Cloudflare 1010 case for custom domains.

## What each has that the other does not

marcomoauro is far ahead on breadth of API surface: `export_subscribers` with
async polling, the 48-column subscriber filter in `SubscriberQuery.js`, image
upload, tags, comments, the whole reader surface, and 16 analytics reports each
verified against the live API with two neighbours deliberately excluded as
broken upstream. That research is careful and this project's equivalents were
written against the same endpoint map.

conorbronsdon is ahead on operational polish: browser login with an encrypted
machine-bound session store, typed errors, the request deadline, explicit
annotations, `get_sections`, and a real test suite.

Neither has: markdown out, embeds, a paywall marker reachable from markdown,
multi-publication support, Note scheduling, templates, or any tooling for
researching other people's publications.

## Summary

| | marcomoauro | conorbronsdon | ours |
|---|---|---|---|
| Tools | 27 | 14 | 62 |
| Language | JavaScript | TypeScript | TypeScript |
| Markdown in | no | yes | yes |
| HTML in | no | no | yes |
| Document validated | yes | no | yes |
| Markdown out | no | no | yes |
| Auto embeds from a URL | no | no | yes |
| Paywall | node only | no | node and marker |
| Publish / delete | unguarded | removed | confirmed |
| Read-only mode | no | no | yes |
| Annotations | no | yes | yes |
| Request timeout | no | yes | yes |
| Retry with backoff | no | no | yes |
| Browser login | no | Playwright | paste, Playwriter or Playwright |
| Multi-publication | no | no | yes |
| Note scheduling | no | no | yes |
| Templates | no | no | yes |
| Competitor research | no | no | yes |
| HTTP transport | no | no | yes |
| Resources and prompts | no | no | 2 and 4 |
| Tests | per-tool specs | ~1,500 lines | 69 tests |

Both are MIT licensed. Nothing here is copied from either: the endpoint paths
are facts about Substack's API, and the implementations are our own.
