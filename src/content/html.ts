/**
 * HTML to Substack's document format.
 *
 * Kept because plenty of callers already hold HTML: a scraped post, a rendered
 * template, output from another CMS. Markdown is the better default, but
 * converting HTML to markdown first and then parsing it loses more than parsing
 * it directly.
 *
 * This is a focused parser for the tags Substack can actually represent, not a
 * general HTML engine. Anything unrecognised degrades to its text content.
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

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, (match) => {
      const known = ENTITIES[match.toLowerCase()];
      if (known) return known;
      const dec = match.match(/^&#(\d+);$/);
      if (dec) return String.fromCodePoint(Number(dec[1]));
      const hex = match.match(/^&#x([0-9a-f]+);$/i);
      if (hex) return String.fromCodePoint(parseInt(hex[1]!, 16));
      return match;
    });
}

/** Wrap bare text in paragraphs so plain input still produces valid blocks. */
export function looksLikeHtml(input: string): boolean {
  return /<(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|br|img|a|strong|em|b|i)\b[^>]*>/i.test(input);
}

export function htmlToDoc(html: string): PMDoc {
  return doc(parseBlocks(html));
}

function parseBlocks(html: string): PMNode[] {
  const nodes: PMNode[] = [];
  const blockStart =
    /<(h[1-6]|p|blockquote|ul|ol|pre|figure)\b[^>]*>|<hr\s*\/?>|<img\b[^>]*>|<paywall\s*\/?>|<youtube\b[^>]*>/gi;

  let match: RegExpExecArray | null;
  let lastEnd = 0;

  while ((match = blockStart.exec(html))) {
    // Text sitting between blocks still counts as a paragraph.
    const between = html.slice(lastEnd, match.index).trim();
    if (between && !/^<[^>]+>$/.test(between)) {
      const stripped = decodeEntities(between.replace(/<[^>]+>/g, "")).trim();
      if (stripped) nodes.push(paragraph(parseInline(between)));
    }

    const token = match[0];

    if (/^<hr/i.test(token)) {
      nodes.push(horizontalRule());
      lastEnd = blockStart.lastIndex;
      continue;
    }

    if (/^<paywall/i.test(token)) {
      nodes.push(paywall());
      lastEnd = blockStart.lastIndex;
      continue;
    }

    if (/^<youtube/i.test(token)) {
      const id = token.match(/id\s*=\s*["']([^"']+)["']/i)?.[1];
      if (id) {
        nodes.push({
          type: "youtube2",
          attrs: { videoId: id, startTime: null, endTime: null },
        });
      }
      lastEnd = blockStart.lastIndex;
      continue;
    }

    if (/^<img/i.test(token)) {
      const src = token.match(/src\s*=\s*["']([^"']+)["']/i)?.[1];
      const alt = token.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1];
      if (src) nodes.push(image(src, alt));
      lastEnd = blockStart.lastIndex;
      continue;
    }

    const tag = match[1]!.toLowerCase();
    const [inner, end] = extractElement(html, tag, blockStart.lastIndex);
    blockStart.lastIndex = end;
    lastEnd = end;

    if (/^h[1-6]$/.test(tag)) {
      nodes.push(heading(Number(tag[1]), parseInline(inner)));
      continue;
    }

    if (tag === "p") {
      const bare = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      if (isBareUrl(bare)) {
        const embed = urlToEmbed(bare);
        if (embed) {
          nodes.push(embed);
          continue;
        }
      }
      const inline = parseInline(inner);
      if (inline.length > 0) nodes.push(paragraph(inline));
      continue;
    }

    if (tag === "pre") {
      const language = inner.match(/<code[^>]*class=["'][^"']*language-([A-Za-z0-9+#._-]+)/i)?.[1];
      const code = decodeEntities(
        inner
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, ""),
      ).replace(/^\n+|\n+$/g, "");
      if (code) nodes.push(codeBlock(code, language));
      continue;
    }

    if (tag === "blockquote") {
      const inners = /<(?:p|h[1-6]|ul|ol)\b/i.test(inner)
        ? parseBlocks(inner)
        : [paragraph(parseInline(inner))];
      nodes.push(blockquote(inners));
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      nodes.push(parseListElement(inner, tag === "ol"));
      continue;
    }

    if (tag === "figure") {
      const src = inner.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1];
      const alt = inner.match(/<img\b[^>]*alt\s*=\s*["']([^"']*)["']/i)?.[1];
      const caption = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1];
      if (src) {
        nodes.push(
          image(
            src,
            alt,
            caption ? decodeEntities(caption.replace(/<[^>]+>/g, "")).trim() : undefined,
          ),
        );
      }
      continue;
    }
  }

  const tail = html.slice(lastEnd).trim();
  if (tail) {
    const stripped = decodeEntities(tail.replace(/<[^>]+>/g, "")).trim();
    if (stripped) nodes.push(paragraph(parseInline(tail)));
  }

  return nodes;
}

/**
 * Find the matching close tag, counting nested opens of the same name.
 * Returns the inner HTML and the index just past the close tag.
 */
function extractElement(html: string, tag: string, from: number): [string, number] {
  const scanner = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  scanner.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(html))) {
    if (match[0][1] === "/") {
      depth--;
      if (depth === 0) {
        return [html.slice(from, match.index), scanner.lastIndex];
      }
    } else {
      depth++;
    }
  }
  return [html.slice(from), html.length];
}

function parseListElement(inner: string, ordered: boolean): PMNode {
  const items: PMNode[] = [];
  const scanner = /<li\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(inner))) {
    const [content, end] = extractElement(inner, "li", scanner.lastIndex);
    scanner.lastIndex = end;

    // A nested list inside the item becomes a child block.
    const children: PMNode[] = [];
    const nested = content.match(/<(ul|ol)\b[^>]*>/i);
    const own = nested ? content.slice(0, nested.index) : content;
    const inlineNodes = parseInline(own);
    children.push(paragraph(inlineNodes));

    if (nested) {
      const nestedTag = nested[1]!.toLowerCase();
      const openAt = content.indexOf(nested[0]) + nested[0].length;
      const [nestedInner] = extractElement(content, nestedTag, openAt);
      children.push(parseListElement(nestedInner, nestedTag === "ol"));
    }

    items.push(listItem(children));
  }

  return ordered ? orderedList(items) : bulletList(items);
}

/** Inline HTML to text nodes with marks, tracking open marks as a stack. */
export function parseInline(html: string): PMNode[] {
  const out: PMNode[] = [];
  const marks: PMMark[] = [];
  const scanner = /<(\/?)(strong|b|em|i|code|s|del|strike|a|br)\b([^>]*)>|([^<]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(html))) {
    if (match[4] !== undefined) {
      const value = decodeEntities(match[4]);
      if (!value) continue;
      out.push(text(value, marks.length > 0 ? marks.map((m) => ({ ...m })) : undefined));
      continue;
    }

    const tag = match[2]!.toLowerCase();
    if (tag === "br") {
      out.push(text("\n", marks.length > 0 ? marks.map((m) => ({ ...m })) : undefined));
      continue;
    }

    const type: PMMark["type"] =
      tag === "strong" || tag === "b"
        ? "strong"
        : tag === "em" || tag === "i"
          ? "em"
          : tag === "code"
            ? "code"
            : tag === "a"
              ? "link"
              : "strikethrough";

    if (match[1] === "/") {
      for (let k = marks.length - 1; k >= 0; k--) {
        if (marks[k]!.type === type) {
          marks.splice(k, 1);
          break;
        }
      }
    } else if (type === "link") {
      const href = match[3]!.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
      marks.push({ type: "link", attrs: { href } });
    } else {
      marks.push({ type });
    }
  }

  return out;
}
