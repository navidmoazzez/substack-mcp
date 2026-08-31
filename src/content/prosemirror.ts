/**
 * Substack's document format.
 *
 * `draft_body` is not HTML. It is a JSON ProseMirror document, and this is the
 * single most common way an integration gets Substack wrong: send HTML and the
 * API accepts it with a 200, then the post renders with the tags visible as
 * literal text. There is no error to catch. You find out by looking at the
 * published post.
 *
 * The schema below was read back off live drafts rather than guessed, including
 * the embed nodes, which are the reason a pasted YouTube link becomes a player
 * instead of a blue link.
 */

export type PMMark = {
  type: "strong" | "em" | "code" | "strikethrough" | "link";
  attrs?: Record<string, unknown>;
};

export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};

export type PMDoc = {
  type: "doc";
  content: PMNode[];
};

/**
 * Published to the model in tool descriptions so it can write structured bodies
 * directly instead of guessing node names. Kept in sync with the builders here.
 */
export const NODE_VOCABULARY = [
  "paragraph",
  "heading (attrs.level 1-6, rendered by Substack as its H1-H3)",
  "blockquote",
  "bullet_list / ordered_list (attrs.order, attrs.tight) with list_item children",
  "code_block (attrs.language)",
  "horizontal_rule",
  "image2 (attrs.src, attrs.alt, attrs.caption)",
  "youtube2 (attrs.videoId)",
  "twitter2 (attrs.url)",
  "spotify2 (attrs.url)",
  "vimeo (attrs.url)",
  "paywall (everything after it is for paying subscribers)",
  "button (attrs.url, attrs.text)",
  "subscribeWidget (attrs.text)",
  "footnote (attrs.number) with footnoteAnchor",
] as const;

export const MARK_VOCABULARY = [
  "strong",
  "em",
  "code",
  "strikethrough",
  "link (attrs.href)",
] as const;

export function doc(content: PMNode[]): PMDoc {
  return {
    type: "doc",
    content: content.length > 0 ? content : [paragraph([])],
  };
}

export function text(value: string, marks?: PMMark[]): PMNode {
  const node: PMNode = { type: "text", text: value };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}

export function paragraph(content: PMNode[]): PMNode {
  return { type: "paragraph", content };
}

/**
 * Substack renders heading level 1 as its largest in-body heading. Markdown `#`
 * maps to level 1 here and Substack styles it down, which is why a post title
 * should be the `title` field rather than an H1 in the body.
 */
export function heading(level: number, content: PMNode[]): PMNode {
  return {
    type: "heading",
    attrs: { level: Math.min(Math.max(level, 1), 6) },
    content,
  };
}

export function blockquote(content: PMNode[]): PMNode {
  return {
    type: "blockquote",
    content: content.length > 0 ? content : [paragraph([])],
  };
}

export function codeBlock(code: string, language?: string): PMNode {
  return {
    type: "code_block",
    attrs: { language: language ?? null },
    content: code ? [text(code)] : [],
  };
}

export function listItem(content: PMNode[]): PMNode {
  return {
    type: "list_item",
    content: content.length > 0 ? content : [paragraph([])],
  };
}

export function bulletList(items: PMNode[], tight = false): PMNode {
  return { type: "bullet_list", attrs: { tight }, content: items };
}

export function orderedList(items: PMNode[], start = 1, tight = false): PMNode {
  return { type: "ordered_list", attrs: { order: start, tight }, content: items };
}

export function horizontalRule(): PMNode {
  return { type: "horizontal_rule" };
}

export function image(src: string, alt?: string, caption?: string): PMNode {
  return {
    type: "image2",
    attrs: {
      src,
      alt: alt ?? null,
      caption: caption ?? null,
      fullscreen: false,
      imageSize: "normal",
    },
  };
}

/**
 * The paywall divider. Everything below it is visible only to paying
 * subscribers. Substack allows exactly one per post.
 */
export function paywall(): PMNode {
  return { type: "paywall" };
}

export function button(url: string, label: string): PMNode {
  return { type: "button", attrs: { url, text: label, class: null } };
}

export function subscribeWidget(label = "Subscribe"): PMNode {
  return {
    type: "subscribeWidget",
    attrs: { url: null, text: label, language: "en" },
    content: [paragraph([text(label)])],
  };
}

/** Serialise for the `draft_body` field, which takes a JSON string. */
export function serialize(document: PMDoc): string {
  return JSON.stringify(document);
}

/**
 * Read a `draft_body` back. Substack returns it as a JSON string, but older
 * drafts and templates can hold a raw object, and a body written by a broken
 * integration can hold HTML. Handle all three rather than throwing.
 */
export function parseBody(raw: unknown): PMDoc | null {
  if (!raw) return null;
  if (typeof raw === "object") {
    const obj = raw as PMDoc;
    return obj.type === "doc" ? obj : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as PMDoc;
    return parsed.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate a document before it is sent, so a bad node name is a clear error
 * here rather than a silently mangled post on Substack.
 */
const KNOWN_NODES = new Set([
  "doc", "paragraph", "heading", "blockquote", "bullet_list", "ordered_list",
  "list_item", "code_block", "horizontal_rule", "text", "image2", "captionedImage",
  "youtube2", "twitter2", "spotify2", "vimeo", "paywall", "button",
  "subscribeWidget", "footnote", "footnoteAnchor", "hard_break", "digest",
  "poll", "latex", "pullquote",
]);

export function validate(document: PMDoc): string[] {
  const problems: string[] = [];

  const walk = (node: PMNode, path: string): void => {
    if (!KNOWN_NODES.has(node.type)) {
      problems.push(
        `${path}: unknown node "${node.type}". Known nodes: ${[...KNOWN_NODES].join(", ")}`,
      );
    }
    if (node.type === "text" && typeof node.text !== "string") {
      problems.push(`${path}: text node has no text`);
    }
    node.content?.forEach((child, i) => walk(child, `${path}.content[${i}]`));
  };

  document.content.forEach((node, i) => walk(node, `content[${i}]`));

  const paywalls = document.content.filter((n) => n.type === "paywall").length;
  if (paywalls > 1) {
    problems.push(`Substack allows one paywall per post, found ${paywalls}`);
  }

  return problems;
}
