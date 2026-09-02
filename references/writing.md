# Writing posts and Notes

Bodies are markdown. Do not send HTML unless the user gave you HTML.

Three things markdown alone will not tell you:

**Embeds.** A line containing only a YouTube, X, Spotify or Vimeo URL becomes a real embedded player. This is usually what the user wants. If they want a plain link, put the URL inside a sentence.

**Paywalls.** `<paywall>` on its own line marks where paid-only content starts. One per post.

**Tables.** Substack has no table node. A markdown table is preserved in a code block instead. If the user wants a real table, tell them it has to be an image or an embed.

Use `preview_draft_body` when you are unsure how something will render. It changes nothing and shows the actual document, including how many embeds were created.

### Editing an existing draft

`get_draft` returns markdown. Edit the part you were asked to change and send the whole body back to `update_draft`. Do not reconstruct the document from scratch, and do not fetch it as `prosemirror` unless you specifically need the raw nodes.

### Sections

`create_draft` takes `section_id`. Call `get_sections` to find it. Do not guess.

### Actions that need confirmation

These refuse to run without `confirm: true`:

`publish_draft`, `delete_draft`, `publish_note`, `publish_note_with_link`, `delete_note`, `comment_on_post`, `delete_comment`, `restack_note`, `remove_tag_from_post`, `delete_template`.

**Do not pass `confirm: true` on your own initiative.** Pass it when the user has actually asked for that specific action. If a tool comes back refused, that is the guard working. Show the user what it would do and ask, rather than retrying with the flag set.

`publish_draft` with `send: true` emails every subscriber and cannot be unsent. If the user wants a post live without emailing anyone, that is `send: false`, and it is worth asking which they meant when it is not obvious.

### Common workflows

**Write this week's post.** `list_posts`, read two or three with `get_post` to match the voice, then `create_draft`. Leave it as a draft.

**What is working.** `rank_posts` by open rate, then again by views, then `get_post_stats` on the top and bottom few. Name specific posts. If the data does not support a conclusion, say so.

**Study a competitor.** `research_creator_posts` sorted by likes, `research_creator_notes` sorted by likes, then `scrape_post` on their two best.

**Find lapsed subscribers.** `list_subscribers` with `num_email_opens_last_30d is 0` and `subscription_created_at is_before` six months ago, `limit: 1` first to get the count cheaply, then `export_subscribers` on the same filter to read the detail.

**Schedule a Note.** `schedule_note`. Tell the user it only fires while the server is running, and that it publishes late rather than being dropped if the machine was off.
