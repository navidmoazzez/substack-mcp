/**
 * Working out who the session belongs to.
 *
 * Substack refuses to create a draft without `draft_bylines`, and the byline is
 * the numeric user id. The old implementation never sent it, which is the other
 * half of why its drafts came out wrong.
 *
 * SUBSTACK_USER_ID is the fast path. When it is not set we resolve the id once
 * per process and cache it, so the model does not have to make the user go
 * hunting in DevTools for a number we can look up ourselves.
 */

import type { SubstackClient } from "./client.js";
import type { Credentials } from "../config.js";

const cache = new Map<string, number>();

type SubscriptionRow = { user_id?: number };
type PublicationUser = { user?: { id?: number }; id?: number };

export async function resolveUserId(
  client: SubstackClient,
  creds: Credentials,
): Promise<number | undefined> {
  if (creds.userId) {
    const n = Number(creds.userId);
    if (Number.isFinite(n)) return n;
  }

  const cached = cache.get(creds.publicationUrl);
  if (cached !== undefined) return cached;

  const api = client.apiUrl(creds);

  // The dashboard uses this to render "signed in as".
  const direct = await client
    .tryRequest<PublicationUser>(`${api}/publication_user`, { creds })
    .catch(() => null);
  const fromDirect = direct?.user?.id ?? direct?.id;
  if (typeof fromDirect === "number") {
    cache.set(creds.publicationUrl, fromDirect);
    return fromDirect;
  }

  // Fallback: the session's own subscription row carries the user id.
  const subscription = await client
    .tryRequest<SubscriptionRow | SubscriptionRow[]>(`${api}/subscription`, { creds })
    .catch(() => null);
  const row = Array.isArray(subscription) ? subscription[0] : subscription;
  if (row && typeof row.user_id === "number") {
    cache.set(creds.publicationUrl, row.user_id);
    return row.user_id;
  }

  return undefined;
}

/**
 * The `draft_bylines` value Substack expects. Returns undefined when the id
 * could not be resolved, so the caller can send the draft without it rather
 * than failing outright.
 */
export async function bylinesFor(
  client: SubstackClient,
  creds: Credentials,
): Promise<{ id: number; is_guest: boolean }[] | undefined> {
  const id = await resolveUserId(client, creds);
  return id === undefined ? undefined : [{ id, is_guest: false }];
}
