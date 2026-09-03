# Security

## Reporting a vulnerability

[Report it privately](https://github.com/thenavidm/substack-mcp/security/advisories/new).
Please do not open a public issue for a security problem: an issue is visible to
everyone the moment you file it, including whoever would use the bug.

Include what you did, what happened, and what you expected. A proof of concept
helps. Reporters are credited in the fix notes unless they would rather not be.

## What this server holds

**Your Substack session cookie**, in `SUBSTACK_SESSION_TOKEN`. Substack has no
public API and no OAuth, so there is no scoped credential to issue. This is the
same cookie your browser holds, and it is full access to your account: posting,
your subscriber list, your billing.

Treat it exactly as you would your password. Never paste it into an issue, a
gist, or a chat. If one leaks, sign out of all sessions from Substack's settings,
which invalidates it, then capture a fresh one.

**A stored session and an audit log**, in `~/.substack-mcp` unless
`SUBSTACK_MCP_HOME` moves them. `substack-mcp login` writes `session.json` at
`0600`, encrypted with AES-256-GCM under a key derived from this machine and OS
account, which is never stored.

Be clear on what that buys. A copied file will not decrypt elsewhere, and a
casual disk or backup read sees ciphertext. It is machine binding, not a vault:
code running as you on this machine can re-derive the key. That is the same
exposure as the environment variable path, which is why environment variables
remain fully supported.

`scheduled-notes.json` sits in the same directory and holds the text of Notes
you have queued but not published.

Nothing leaves your machine except calls to Substack. No telemetry.

## Write safety

Writes work by default, because publishing is the point of the server. A server
where every write needs a flag teaches the operator to set that flag
permanently, which is worse than no protection because it looks like protection.

Three graduated mechanisms instead:

**`confirm: true` on the operations that cannot be taken back.** Publishing a
draft with `send: true` emails every subscriber you have, and an email cannot be
unsent. Deleting a draft, a Note, a comment or a template is permanent with no
trash to recover from. Publishing a Note, commenting and restacking are public
the instant they run, with no draft state in between.

Creating and editing drafts, tagging, scheduling and adding a subscriber are not
guarded. Each is private or reversible, and confirming everything trains the
model to pass `confirm` reflexively, which is worse than not asking.

**`SUBSTACK_READ_ONLY=1` removes every write from the tool list.** Not a refusal
at call time: the tools are never registered, leaving 41 read tools. A model
cannot call a tool it cannot see, and cannot argue with a refusal it never
receives. This is the setting for pointing an untrusted agent at a publication.

**`SUBSTACK_ALLOW_DESTRUCTIVE=0`** sits between the two: drafting and tagging
keep working, publishing and deleting do not.

**`SUBSTACK_AUDIT_LOG=<path>` records every attempted write**, allowed and
blocked alike, one JSON line each. The model has no tool to read or edit that
file.

## Untrusted content

Comments, your reader feed, another writer's posts and Notes, and anything the
research tools return are all text other people wrote. "Summarise my comments"
is one of the first things anyone asks.

Treat that content as data to report on, never as instructions. Every tool that
returns it says so in its own response, and the server's instructions tell the
model the same. The risk is highest when writes are enabled, because a comment
is a text field aimed at an agent that can publish.

## Uploading images

`upload_image` takes a URL and fetches it. Private, loopback and link-local
destinations are refused, and redirects are followed manually so the check
applies to every hop, so it cannot be turned into a proxy into a private
network. Files are capped at 10MB and the type is read from the file's contents
rather than its extension.

The URL it returns is unlisted, not secret. Anyone holding it can fetch the
image, including before the post is published.

## Running it over HTTP

The HTTP transport validates `Origin` and supports a bearer token, but that is a
lock on one door, not an authentication system. It belongs behind TLS and an
authenticating reverse proxy.

Do not expose it directly. It holds a live credential for your Substack account,
and an open endpoint hands it to anyone who finds the port. Binding beyond
localhost without a token logs a warning for exactly this reason.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to the service the tool talks to, not to the code. When
testing, use your own account and your own data. Do not point it at somebody
else's, and do not hammer a shared API to the point where other people notice.
If a test could affect anyone but you, stop and send a private report first.

Research done in that spirit is welcome, and nothing here is a trap.

## Supported versions

The latest published version gets fixes. Given the size of this project, older
versions do not.
