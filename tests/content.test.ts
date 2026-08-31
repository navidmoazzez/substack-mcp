import { describe, expect, it } from "vitest";
import { toDoc, toDraftBody, draftBodyToMarkdown, detectFormat } from "../src/content/body.js";
import { markdownToDoc } from "../src/content/markdown.js";
import { docToMarkdown } from "../src/content/to-markdown.js";
import { htmlToDoc } from "../src/content/html.js";
import { urlToEmbed, extractYouTubeId } from "../src/content/embeds.js";
import { validate } from "../src/content/prosemirror.js";

describe("the bug this rewrite exists to fix", () => {
  it("never sends HTML as draft_body", () => {
    const body = toDraftBody("<p>Hello <strong>world</strong></p>");
    const parsed = JSON.parse(body);

    expect(parsed.type).toBe("doc");
    // The old implementation produced the literal string "<p>Hello...</p>",
    // which Substack accepts and then renders as visible tags.
    expect(body).not.toContain("<p>");
    expect(parsed.content[0].type).toBe("paragraph");
    expect(parsed.content[0].content[1].marks[0].type).toBe("strong");
  });

  it("produces a valid document from plain text", () => {
    const parsed = JSON.parse(toDraftBody("Just a sentence."));
    expect(validate(parsed)).toEqual([]);
  });
});

describe("format detection", () => {
  it("recognises a prosemirror document", () => {
    expect(detectFormat('{"type":"doc","content":[]}')).toBe("prosemirror");
  });
  it("recognises html", () => {
    expect(detectFormat("<p>hi</p>")).toBe("html");
  });
  it("falls back to markdown", () => {
    expect(detectFormat("# Heading\n\ntext")).toBe("markdown");
  });
});

describe("markdown to document", () => {
  it("handles headings, bold, italic, code and links", () => {
    const d = markdownToDoc(
      "## Title\n\nSome **bold** and *italic* and `code` and [a link](https://example.com).",
    );
    expect(d.content[0]!.type).toBe("heading");
    expect(d.content[0]!.attrs!.level).toBe(2);

    const marks = (d.content[1]!.content ?? []).flatMap((n) => n.marks ?? []).map((m) => m.type);
    expect(marks).toContain("strong");
    expect(marks).toContain("em");
    expect(marks).toContain("code");
    expect(marks).toContain("link");
  });

  it("nests lists to arbitrary depth and mixes types", () => {
    const d = markdownToDoc("- one\n  1. nested\n  2. also nested\n- two");
    const list = d.content[0]!;
    expect(list.type).toBe("bullet_list");
    expect(list.content).toHaveLength(2);

    const nested = list.content![0]!.content![1]!;
    expect(nested.type).toBe("ordered_list");
    expect(nested.content).toHaveLength(2);
  });

  it("keeps a table verbatim instead of mangling it", () => {
    const d = markdownToDoc("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(d.content[0]!.type).toBe("code_block");
    expect(d.content[0]!.content![0]!.text).toContain("| a | b |");
  });

  it("marks a paywall", () => {
    const d = markdownToDoc("Free part.\n\n<paywall>\n\nPaid part.");
    expect(d.content.map((n) => n.type)).toEqual(["paragraph", "paywall", "paragraph"]);
  });

  it("preserves a fenced code block with its language", () => {
    const d = markdownToDoc("```ts\nconst x = 1;\n```");
    expect(d.content[0]!.type).toBe("code_block");
    expect(d.content[0]!.attrs!.language).toBe("ts");
    expect(d.content[0]!.content![0]!.text).toBe("const x = 1;");
  });

  it("does not treat snake_case as emphasis", () => {
    const d = markdownToDoc("call some_function_name now");
    const text = (d.content[0]!.content ?? []).map((n) => n.text).join("");
    expect(text).toBe("call some_function_name now");
  });
});

describe("embeds", () => {
  it("extracts a video id from every youtube url shape", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/watch?list=PL123&v=${id}`,
    ]) {
      expect(extractYouTubeId(url)).toBe(id);
    }
  });

  it("turns a lone youtube link into a player, not a link", () => {
    const d = markdownToDoc("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(d.content[0]!.type).toBe("youtube2");
    expect(d.content[0]!.attrs!.videoId).toBe("dQw4w9WgXcQ");
  });

  it("rewrites x.com to twitter.com so the card resolves", () => {
    const node = urlToEmbed("https://x.com/someone/status/123456");
    expect(node!.type).toBe("twitter2");
    expect(node!.attrs!.url).toContain("twitter.com");
  });

  it("leaves an ordinary link alone", () => {
    expect(urlToEmbed("https://example.com/post")).toBeNull();
  });

  it("keeps a url inside a sentence as a link", () => {
    const d = markdownToDoc("See https://www.youtube.com/watch?v=dQw4w9WgXcQ for more.");
    expect(d.content[0]!.type).toBe("paragraph");
  });
});

describe("html to document", () => {
  it("converts headings, lists and blockquotes", () => {
    const d = htmlToDoc("<h2>Title</h2><ul><li>one</li><li>two</li></ul><blockquote>quote</blockquote>");
    expect(d.content.map((n) => n.type)).toEqual(["heading", "bullet_list", "blockquote"]);
  });

  it("decodes entities", () => {
    const d = htmlToDoc("<p>Tom &amp; Jerry &#8212; done</p>");
    expect(d.content[0]!.content![0]!.text).toContain("Tom & Jerry");
  });

  it("handles nested lists", () => {
    const d = htmlToDoc("<ul><li>one<ul><li>deep</li></ul></li></ul>");
    const nested = d.content[0]!.content![0]!.content![1]!;
    expect(nested.type).toBe("bullet_list");
  });
});

describe("round trip", () => {
  it("survives markdown to document and back", () => {
    const source = [
      "# Heading",
      "",
      "A paragraph with **bold**, *italic* and a [link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "> a quote",
      "",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");

    const back = docToMarkdown(markdownToDoc(source));

    expect(back).toContain("# Heading");
    expect(back).toContain("**bold**");
    expect(back).toContain("*italic*");
    expect(back).toContain("[link](https://example.com)");
    expect(back).toContain("- one");
    expect(back).toContain("> a quote");
    expect(back).toContain("```js");
  });

  it("reads a draft_body json string back as markdown", () => {
    const stored = toDraftBody("## Section\n\nText here.");
    expect(draftBodyToMarkdown(stored)).toBe("## Section\n\nText here.");
  });

  it("recovers a body that a broken integration stored as html", () => {
    expect(draftBodyToMarkdown("<p>Rescued <strong>text</strong></p>")).toBe(
      "Rescued **text**",
    );
  });
});

describe("validation", () => {
  it("rejects an unknown node instead of letting Substack render it wrong", () => {
    expect(() =>
      toDoc('{"type":"doc","content":[{"type":"nonsense"}]}', "prosemirror"),
    ).toThrow(/unknown node/);
  });

  it("rejects a second paywall", () => {
    expect(() =>
      toDoc('{"type":"doc","content":[{"type":"paywall"},{"type":"paywall"}]}', "prosemirror"),
    ).toThrow(/one paywall/);
  });
});
