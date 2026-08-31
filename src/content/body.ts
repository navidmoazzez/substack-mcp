/**
 * One entry point for every body-shaped argument.
 *
 * Callers hand us markdown, HTML, or a ready-made ProseMirror document, and
 * usually do not say which. Sniffing beats making every tool take a `format`
 * argument the model has to reason about and will sometimes get wrong.
 *
 * Order matters: a JSON document is unambiguous, HTML is detectable by its
 * tags, and markdown is the fallback because it is also what plain text is.
 */

import { htmlToDoc, looksLikeHtml } from "./html.js";
import { markdownToDoc } from "./markdown.js";
import { docToMarkdown } from "./to-markdown.js";
import {
  doc,
  paragraph,
  parseBody,
  serialize,
  validate,
  type PMDoc,
} from "./prosemirror.js";

export type BodyFormat = "markdown" | "html" | "prosemirror" | "auto";

export function detectFormat(input: string): Exclude<BodyFormat, "auto"> {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") && /"type"\s*:\s*"doc"/.test(trimmed)) {
    return "prosemirror";
  }
  if (looksLikeHtml(trimmed)) return "html";
  return "markdown";
}

/**
 * Build a Substack document from whatever the caller sent.
 *
 * Throws on an invalid ProseMirror document rather than letting a bad node name
 * reach Substack, which would accept it and render the post wrong with no error.
 */
export function toDoc(input: string, format: BodyFormat = "auto"): PMDoc {
  if (!input || !input.trim()) {
    return doc([paragraph([])]);
  }

  const resolved = format === "auto" ? detectFormat(input) : format;

  if (resolved === "prosemirror") {
    const parsed = parseBody(input);
    if (!parsed) {
      throw new Error(
        "Body was declared as a ProseMirror document but did not parse as one. It must be JSON shaped like {\"type\":\"doc\",\"content\":[...]}.",
      );
    }
    const problems = validate(parsed);
    if (problems.length > 0) {
      throw new Error(`Invalid Substack document:\n- ${problems.join("\n- ")}`);
    }
    return parsed;
  }

  return resolved === "html" ? htmlToDoc(input) : markdownToDoc(input);
}

/** The JSON string Substack's `draft_body` field expects. */
export function toDraftBody(input: string, format: BodyFormat = "auto"): string {
  return serialize(toDoc(input, format));
}

/** Read a `draft_body` back as markdown, for editing. */
export function draftBodyToMarkdown(raw: unknown): string {
  const parsed = parseBody(raw);
  if (!parsed) {
    // A body written by an integration that sent raw HTML. Recover what we can
    // rather than returning a blob the model cannot work with.
    if (typeof raw === "string" && raw.trim()) {
      return docToMarkdown(htmlToDoc(raw));
    }
    return "";
  }
  return docToMarkdown(parsed);
}

export { docToMarkdown };
