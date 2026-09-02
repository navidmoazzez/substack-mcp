# Reading

## Your own publication

`list-posts` and `list-drafts` are the two starting points. `get-post` and
`get-draft` return one, with the body as markdown you can edit and hand back to
`update-draft`.

`list-scheduled-posts` and `list-scheduled-notes` show what is queued. Scheduled
work does not appear in the ordinary lists, so check both before telling someone
nothing is planned.

`rank-posts` and `get-post-stats` are the performance side, and
`get-dashboard-summary` is the one-call overview.

## Other writers

`research-creator-posts` and `research-creator-notes` study someone else.
`compare-publications` puts two side by side. `scrape-post` reads a single
public post from its URL, and `search-publications` finds them by name.

These reach what a logged-out reader reaches: posts, Notes, public profile data.
Never another publication's subscribers, drafts or revenue.

Four commands need no credentials at all, so research works before setup:
`search-publications`, `get-publication-info`, `scrape-post`, and `get-post`
against a public publication.

## The reader side

`get-reader-feed` is your own Substack feed, `list-subscriptions` what you
subscribe to, `get-profile-feed` one person's Notes, `get-comment-thread` a
discussion.

## What `--json` gives you

Reads return the text shaped for a model rather than raw API JSON, so `--json`
hands you that text as a JSON string rather than fields to filter. Writes and
the account commands return real objects, and `--select` works on those.
