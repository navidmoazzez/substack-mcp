/**
 * Substack's document format back to markdown.
 *
 * Neither reference implementation does this, and its absence is why editing an
 * existing draft through them is so awkward: you can read a draft, but what
 * comes back is a wall of ProseMirror JSON. A model then has to reconstruct the
 * whole document to change one sentence, and usually flattens the formatting
 * doing it.
 *
 * With this, `get_draft` returns readable markdown, the model edits the part it
 * was asked to change, and `update_draft` parses it straight back. Round trip.
 */

import type { PMDoc, PMMark, PMNode } from "./prosemirror.js";

export function docToMarkdown(document: PMDoc): string {
  return document.content
    .map((node) => renderBlock(node, 0))
    .filter((block) => block !== "")
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderBlock(node: PMNode, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content ?? []);

    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${renderInline(node.content ?? [])}`;
    }

    case "blockquote":
      return (node.content ?? [])
        .map((child) => renderBlock(child, depth))
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");

    case "code_block": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const body = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${language}\n${body}\n\`\`\``;
    }

    case "bullet_list":
      return renderList(node, depth, false);

    case "ordered_list":
      return renderList(node, depth, true);

    case "horizontal_rule":
      return "---";

    case "paywall":
      return "<paywall>";

    case "image2":
    case "captionedImage": {
      const src = String(node.attrs?.src ?? "");
      const alt = String(node.attrs?.alt ?? "");
      const caption = node.attrs?.caption;
      const title = typeof caption === "string" && caption ? ` "${caption}"` : "";
      return src ? `![${alt}](${src}${title})` : "";
    }

    case "youtube2": {
      const id = String(node.attrs?.videoId ?? "");
      return id ? `https://www.youtube.com/watch?v=${id}` : "";
    }

    case "twitter2":
    case "spotify2":
    case "vimeo":
      return String(node.attrs?.url ?? "");

    case "button": {
      const url = String(node.attrs?.url ?? "");
      const label = String(node.attrs?.text ?? "Read more");
      return url ? `[${label}](${url})` : "";
    }

    case "subscribeWidget":
      return "<subscribe>";

    case "footnote": {
      const number = node.attrs?.number ?? "";
      return `[^${number}]: ${renderInline(node.content ?? [])}`;
    }

    case "text":
      return renderInline([node]);

    default:
      // An unknown node still has readable content most of the time. Render it
      // rather than dropping the words.
      if (node.content) {
        return node.content.map((child) => renderBlock(child, depth)).join("\n\n");
      }
      return "";
  }
}

function renderList(node: PMNode, depth: number, ordered: boolean): string {
  const start = ordered ? Number(node.attrs?.order ?? 1) : 1;
  const indent = "  ".repeat(depth);

  return (node.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}.` : "-";
      const blocks = item.content ?? [];

      const [first, ...rest] = blocks;
      const head = first ? renderBlock(first, depth) : "";
      const tail = rest
        .map((child) =>
          child.type === "bullet_list" || child.type === "ordered_list"
            ? renderBlock(child, depth + 1)
            : renderBlock(child, depth)
              .split("\n")
              .map((line) => `${indent}  ${line}`)
              .join("\n"),
        )
        .filter(Boolean);

      return [`${indent}${marker} ${head}`, ...tail].join("\n");
    })
    .join("\n");
}

/** Marks are applied innermost first so nesting survives the round trip. */
const MARK_ORDER: PMMark["type"][] = ["code", "strikethrough", "em", "strong", "link"];

function renderInline(nodes: PMNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "hard_break") return "\n";
      let value = node.text ?? "";
      if (!value) {
        return node.content ? renderInline(node.content) : "";
      }

      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
      );

      for (const mark of marks) {
        switch (mark.type) {
          case "strong":
            value = `**${value}**`;
            break;
          case "em":
            value = `*${value}*`;
            break;
          case "code":
            value = `\`${value}\``;
            break;
          case "strikethrough":
            value = `~~${value}~~`;
            break;
          case "link": {
            const href = String(mark.attrs?.href ?? "");
            value = href ? `[${value}](${href})` : value;
            break;
          }
        }
      }
      return value;
    })
    .join("");
}
