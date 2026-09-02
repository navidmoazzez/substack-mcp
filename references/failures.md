# When something fails

| Message | What to do |
|---|---|
| "will not run without --confirm" | Confirm with the user, then retry with `--confirm` |
| "No Substack credentials configured" | Nothing is set up. `substack-mcp login`, or set the two env vars |
| An auth error on a setup that worked | The session cookie expired. About 90 days is normal |
| 403 with `error code: 1010` | Cloudflare blocking a custom domain. Use the `*.substack.com` host |
| Analytics returning empty | Some reports have no data until the publication has paid subscribers |
| Every write refused, reads fine | `SUBSTACK_READ_ONLY=1` is set |

Start with `substack-mcp doctor`. It checks credentials, config, connectivity
and byline resolution, and names the problem rather than the symptom.

### When not to reach for this

Substack publishes no API. These are the endpoints its own web app calls, so
they can change without notice and a working setup can break without anything
on this side changing.

It cannot see another publication's subscribers, drafts or revenue. Research
tools reach what a logged-out reader can reach, which is posts, Notes and
public profile data.

A published post cannot be unpublished. It has already been emailed to every
subscriber, and deleting it afterwards does not recall the email.
