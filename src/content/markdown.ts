/**
 * Markdown to Substack's document format.
 *
 * Markdown is what a language model writes without being asked, so it is the
 * default input for every body-shaped argument in this server. Anything not
 * representable in Substack's schema is preserved rather than dropped, because
 * silently losing a paragraph is worse than rendering it plainly.
 *
 * Deliberate choices:
 *   - a line that is only a URL becomes a real embed, not a link
 *   - tables have no node in Substack's editor, so a GFM table is kept verbatim
 *     in a code block where the content survives and can be reformatted
 *   - lists nest to any depth and may mix ordered and unordered
 */

import {
  blockquote,
  bulletList,
  codeBlock,
  doc,
  heading,
  horizontalRule,
  image,
  listItem,
  orderedList,
  paragraph,
  paywall,
  text,
  type PMDoc,
  type PMMark,
  type PMNode,
} from "./prosemirror.js";
import { isBareUrl, urlToEmbed } from "./embeds.js";

/** How a caller marks the paywall divider in markdown. */
const PAYWALL_MARKERS = /^(?:<paywall\s*\/?>|:{3,}\s*paywall|-{3,}\s*paywall\s*-{3,})$/i;

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^(?:\*{3,}|-{3,}|_{3,})$/;
const FENCE = /^(?:```|~~~)\s*([A-Za-z0-9+#._-]*)\s*$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;

export function markdownToDoc(markdown: string): PMDoc {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  return doc(parseBlocks(lines));
}

function parseBlocks(lines: string[]): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (PAYWALL_MARKERS.test(trimmed)) {
      out.push(paywall());
      i++;
      continue;
    }

    const fence = trimmed.match(FENCE);
    if (fence) {
      const language = fence[1] || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!.trim())) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      out.push(codeBlock(body.join("\n"), language));
      continue;
    }

    const head = trimmed.match(HEADING);
    if (head) {
      out.push(heading(head[1]!.length, parseInline(head[2]!)));
      i++;
      continue;
    }

    if (HR.test(trimmed)) {
      out.push(horizontalRule());
      i++;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && (BLOCKQUOTE.test(lines[i]!) || lines[i]!.trim() === "")) {
        if (lines[i]!.trim() === "") {
          // A blank line ends the quote unless the next line continues it.
          if (!lines[i + 1] || !BLOCKQUOTE.test(lines[i + 1]!)) break;
          quoted.push("");
        } else {
          quoted.push(lines[i]!.match(BLOCKQUOTE)![1]!);
        }
        i++;
      }
      out.push(blockquote(parseBlocks(quoted)));
      continue;
    }

    // A GFM table has no Substack node. Keep it verbatim so nothing is lost.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      const table: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        table.push(lines[i]!.trim());
        i++;
      }
      out.push(codeBlock(table.join("\n"), "markdown"));
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    const imageOnly = trimmed.match(IMAGE_ONLY);
    if (imageOnly) {
      out.push(image(imageOnly[2]!, imageOnly[1] || undefined, imageOnly[3]));
      i++;
      continue;
    }

    // A line that is only a URL becomes a player rather than a link.
    if (isBareUrl(trimmed)) {
      const embed = urlToEmbed(trimmed);
      if (embed) {
        out.push(embed);
        i++;
        continue;
      }
    }

    // Everything else is a paragraph, running until a blank line or a block start.
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!;
      if (current.trim() === "") break;
      if (
        HEADING.test(current.trim()) ||
        HR.test(current.trim()) ||
        FENCE.test(current.trim()) ||
        BLOCKQUOTE.test(current) ||
        BULLET.test(current) ||
        ORDERED.test(current) ||
        PAYWALL_MARKERS.test(current.trim())
      ) {
        break;
      }
      para.push(current.trim());
      i++;
    }
    if (para.length > 0) {
      out.push(paragraph(parseInline(para.join(" "))));
    }
  }

  return out;
}

/** Indentation width, counting a tab as two spaces. */
function indentOf(line: string): number {
  const match = line.match(/^(\s*)/);
  return (match?.[1] ?? "").replace(/\t/g, "  ").length;
}

/**
 * Parse one list and everything nested inside it.
 *
 * Returns the finished node and the index of the first line after the list.
 * Nesting is by indentation, and a deeper line recurses so ordered and
 * unordered can interleave at any depth.
 */
function parseList(lines: string[], start: number): [PMNode, number] {
  const first = lines[start]!;
  const baseIndent = indentOf(first);
  const isOrdered = ORDERED.test(first);
  const startNumber = isOrdered ? Number(first.match(ORDERED)![2]) : 1;

  const items: PMNode[] = [];
  let i = start;
  let tight = true;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      // A blank line inside a list makes it loose, but only if the list continues.
      const next = lines[i + 1];
      if (next && indentOf(next) >= baseIndent && (BULLET.test(next) || ORDERED.test(next))) {
        tight = false;
        i++;
        continue;
      }
      break;
    }

    const indent = indentOf(line);
    if (indent < baseIndent) break;

    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (!bullet && !ordered) break;

    // A different marker type at this level starts a new list.
    const lineOrdered = Boolean(ordered);
    if (indent === baseIndent && lineOrdered !== isOrdered) break;

    if (indent > baseIndent) {
      // Deeper than us: belongs to the previous item.
      const [nested, next] = parseList(lines, i);
      const previous = items[items.length - 1];
      if (previous) {
        previous.content = [...(previous.content ?? []), nested];
      } else {
        items.push(listItem([nested]));
      }
      i = next;
      continue;
    }

    const content = (bullet ? bullet[2] : ordered![3])!;
    items.push(listItem([paragraph(parseInline(content))]));
    i++;
  }

  const node = isOrdered
    ? orderedList(items, startNumber, tight)
    : bulletList(items, tight);
  return [node, i];
}

/**
 * Inline markdown to text nodes with marks.
 *
 * Handled in one pass so nesting works: a link inside bold keeps both marks.
 */
export function parseInline(input: string): PMNode[] {
  const out: PMNode[] = [];
  let buffer = "";
  let i = 0;
  const marks: PMMark[] = [];

  const flush = (): void => {
    if (buffer.length > 0) {
      out.push(text(buffer, marks.length > 0 ? marks.map((m) => ({ ...m })) : undefined));
      buffer = "";
    }
  };

  const toggle = (type: PMMark["type"]): void => {
    const at = marks.findIndex((m) => m.type === type);
    if (at >= 0) marks.splice(at, 1);
    else marks.push({ type });
  };

  while (i < input.length) {
    const rest = input.slice(i);

    // Escaped character
    if (rest[0] === "\\" && rest.length > 1) {
      buffer += rest[1];
      i += 2;
      continue;
    }

    // Inline code wins over every other mark, per CommonMark.
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      flush();
      out.push(text(code[1]!, [...marks.map((m) => ({ ...m })), { type: "code" }]));
      i += code[0].length;
      continue;
    }

    const img = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (img) {
      // An inline image inside a paragraph has no node, so keep the alt text
      // and link to the source rather than dropping it.
      flush();
      out.push(
        text(img[1] || img[2]!, [
          ...marks.map((m) => ({ ...m })),
          { type: "link", attrs: { href: img[2]! } },
        ]),
      );
      i += img[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (link) {
      flush();
      const inner = parseInline(link[1]!);
      const href = link[2]!;
      for (const node of inner) {
        node.marks = [
          ...(node.marks ?? []),
          ...marks.map((m) => ({ ...m })),
          { type: "link", attrs: { href } } as PMMark,
        ];
        out.push(node);
      }
      i += link[0].length;
      continue;
    }

    if (rest.startsWith("***") || rest.startsWith("___")) {
      flush();
      toggle("strong");
      toggle("em");
      i += 3;
      continue;
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      flush();
      toggle("strong");
      i += 2;
      continue;
    }
    if (rest.startsWith("~~")) {
      flush();
      toggle("strikethrough");
      i += 2;
      continue;
    }
    // A single * or _ is emphasis, with two exceptions.
    if (rest[0] === "*" || rest[0] === "_") {
      const open = marks.some((m) => m.type === "em");
      const before = input[i - 1];
      const after = rest[1];

      // Mid-word underscores are snake_case, not emphasis.
      const midWord =
        rest[0] === "_" && Boolean(before) && /\w/.test(before!) && Boolean(after) && /\w/.test(after!);

      // "* " opens nothing, since a bullet reached the inline parser. But once
      // emphasis is open, "* " is the closing delimiter before a space and must
      // still close, or the mark leaks across the rest of the paragraph.
      const strayBullet = !open && /^[*_]\s/.test(rest);

      if (!midWord && !strayBullet) {
        flush();
        toggle("em");
        i += 1;
        continue;
      }
    }

    // A bare URL inside a paragraph becomes a link.
    const bare = rest.match(/^https?:\/\/[^\s<>()]+/);
    if (bare) {
      flush();
      out.push(
        text(bare[0], [
          ...marks.map((m) => ({ ...m })),
          { type: "link", attrs: { href: bare[0] } },
        ]),
      );
      i += bare[0].length;
      continue;
    }

    buffer += rest[0];
    i += 1;
  }

  flush();
  return out;
}
