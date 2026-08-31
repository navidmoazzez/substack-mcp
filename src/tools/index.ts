/** Every tool, in the order they appear in the README. */

import type { AnyToolSpec } from "./kit.js";

import { analyticsTools } from "./analytics.js";
import { commentTools } from "./comments.js";
import { draftTools } from "./drafts.js";
import { mediaTools } from "./media.js";
import { noteTools } from "./notes.js";
import { postTools } from "./posts.js";
import { publicationTools } from "./publication.js";
import { readerTools } from "./reader.js";
import { researchTools } from "./research.js";
import { subscriberTools } from "./subscribers.js";
import { tagTools } from "./tags.js";
import { templateTools } from "./templates.js";

export const ALL_TOOLS: AnyToolSpec[] = [
  ...draftTools,
  ...postTools,
  ...noteTools,
  ...subscriberTools,
  ...analyticsTools,
  ...tagTools,
  ...commentTools,
  ...readerTools,
  ...publicationTools,
  ...templateTools,
  ...researchTools,
  ...mediaTools,
];

export const TOOL_GROUPS: Record<string, AnyToolSpec[]> = {
  drafts: draftTools,
  posts: postTools,
  notes: noteTools,
  subscribers: subscriberTools,
  analytics: analyticsTools,
  tags: tagTools,
  comments: commentTools,
  reader: readerTools,
  publication: publicationTools,
  templates: templateTools,
  research: researchTools,
  media: mediaTools,
};
