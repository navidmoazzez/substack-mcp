/**
 * Turning a pasted URL into a real embed.
 *
 * A model writing a newsletter puts a YouTube link on its own line and expects
 * a player. Send that through as a paragraph and Substack renders a blue link,
 * which is the single most visible way an AI-written post looks AI-written.
 *
 * Substack's editor does this conversion client-side, so it never happens for
 * anything written through the API. Doing it here is why a draft from this
 * server looks like one a person made in the editor.
 *
 * Node shapes were read off live drafts.
 */

import type { PMNode } from "./prosemirror.js";

/**
 * Pull an 11-character video id out of any YouTube URL shape: watch?v=,
 * youtu.be, /embed/, /shorts/, /live/. Extra parameters such as &list= and &t=
 * are ignored rather than breaking the match.
 */
export function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/|watch\?(?:[^"'\s<]*&)?v=))([A-Za-z0-9_-]{11})/i,
  );
  return match ? match[1]! : null;
}

/** Seconds into the video, from a `t=` or `start=` parameter. */
function extractStartTime(url: string): number | null {
  const match = url.match(/[?&](?:t|start)=(\d+)/i);
  if (match) return Number(match[1]);
  // youtu.be links use t=1m30s
  const hms = url.match(/[?&]t=(?:(\d+)m)?(\d+)s/i);
  if (hms) return Number(hms[1] ?? 0) * 60 + Number(hms[2]);
  return null;
}

/**
 * Map a standalone URL to its embed node, or null when the host is not one
 * Substack embeds. Callers fall back to a normal link for null.
 */
export function urlToEmbed(url: string): PMNode | null {
  const clean = url.trim();

  const youtubeId = extractYouTubeId(clean);
  if (youtubeId) {
    return {
      type: "youtube2",
      attrs: {
        videoId: youtubeId,
        startTime: extractStartTime(clean),
        endTime: null,
      },
    };
  }

  if (/(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(clean)) {
    // Substack's embed resolves twitter.com. An x.com URL renders as a dead
    // card, so rewrite the host and keep the rest of the URL intact.
    return {
      type: "twitter2",
      attrs: {
        url: clean.replace(/^(https?:\/\/)(?:www\.)?x\.com/i, "$1twitter.com"),
      },
    };
  }

  if (/open\.spotify\.com\/(?:track|episode|show|playlist|album|artist)\//i.test(clean)) {
    return { type: "spotify2", attrs: { url: clean } };
  }

  if (/(?:^|\/\/|\.)vimeo\.com\/\d+/i.test(clean)) {
    return { type: "vimeo", attrs: { url: clean } };
  }

  return null;
}

/** True when a line is nothing but a URL, so it is safe to replace with an embed. */
export function isBareUrl(line: string): boolean {
  return /^https?:\/\/\S+$/i.test(line.trim());
}
