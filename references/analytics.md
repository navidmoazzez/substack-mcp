# Analytics

`get_dashboard_summary` is the best single call for "how is my newsletter doing".

`get_analytics` covers 16 reports. `audience_overlap` names the publications whose readers overlap the user's, which is the answer to "who should I do a swap with". `retention` is cohort retention over 12 months.

`rank_posts` sorts by any metric. Use it before `get_post_stats`, which is one post at a time.

### Subscribers

`list_subscribers` filters on 48 columns but returns only the columns saved in the publication's Display settings. It ignores a per-request column list, so the values you filtered on are often not in the response. To actually read engagement numbers, use `export_subscribers`.

Filters combine with AND only. No OR, no nesting. Anything needing OR is separate calls.

`add_subscriber` is for people who asked to be added. Do not bulk-import a list the user scraped from somewhere.

### Research on other publications

`research_creator_posts` and `research_creator_notes` return engagement numbers, so sort by `likes` or `restacks` rather than reading in date order. `compare_publications` handles up to ten at once and ranks everything together.

`scrape_post` reads any public post from a URL. Paywalled posts return only the free preview.
