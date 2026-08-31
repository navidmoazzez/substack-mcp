/**
 * Getting an image into Substack.
 *
 * Substack's upload endpoint takes a data URI under `image`, not a file upload
 * and not a URL. So whichever way the caller supplies the image, it has to be
 * read into memory and encoded first.
 *
 * Two hazards worth guarding, because this is the one tool that takes an
 * arbitrary URL from a model and fetches it:
 *   - SSRF. A model can be talked into passing http://169.254.169.254/ or a
 *     localhost address, which would make this server a proxy into a private
 *     network. Private, loopback and link-local destinations are refused, and
 *     redirects are followed manually so the check applies to every hop.
 *   - Size. An unbounded download becomes an unbounded base64 string in memory
 *     and then a rejected request, so it is capped before that happens.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Signatures, because a file extension is a claim rather than evidence. */
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", test: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8") },
  {
    mime: "image/webp",
    test: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export function detectMimeType(bytes: Buffer): string | null {
  for (const { mime, test } of SIGNATURES) {
    try {
      if (test(bytes)) return mime;
    } catch {
      // A buffer shorter than the signature is simply not a match.
    }
  }
  return null;
}

/** RFC 1918, loopback, link-local and unique-local ranges. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts as [number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, including cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(normalized)) return true; // unique-local
    // An IPv4-mapped address hides a v4 target inside a v6 literal.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }

  return false;
}

async function assertPublicHost(urlString: string): Promise<void> {
  const url = new URL(urlString);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to fetch ${url.protocol}// . Only http and https are allowed.`);
  }

  const host = url.hostname;
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error(`Refusing to fetch a private address (${host}).`);
    }
    return;
  }

  if (/^localhost$|\.local$|\.internal$/i.test(host)) {
    throw new Error(`Refusing to fetch an internal hostname (${host}).`);
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}.`);
  }

  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Refusing to fetch ${host}: it resolves to a private address (${address}).`,
      );
    }
  }
}

/** Download an image and return it as a data URI, checking every redirect hop. */
export async function fetchImageAsDataUri(
  url: string,
  userAgent: string,
  timeoutMs: number,
): Promise<{ dataUri: string; mimeType: string; bytes: number }> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        headers: { "User-Agent": userAgent, Accept: "image/*" },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect from ${current} had no Location header.`);
      current = new URL(location, current).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`Could not download the image: ${res.status} from ${current}`);
    }

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is ${Math.round(declared / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.`,
      );
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is ${Math.round(bytes.byteLength / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.`,
      );
    }

    const mimeType = detectMimeType(bytes);
    if (!mimeType) {
      throw new Error(
        "That file is not a PNG, JPEG, GIF or WebP. Substack does not accept HEIC or SVG here.",
      );
    }

    return {
      dataUri: `data:${mimeType};base64,${bytes.toString("base64")}`,
      mimeType,
      bytes: bytes.byteLength,
    };
  }

  throw new Error(`Too many redirects starting from ${url}.`);
}

/** Read a local file and return it as a data URI. */
export async function readImageFileAsDataUri(
  path: string,
): Promise<{ dataUri: string; mimeType: string; bytes: number }> {
  if (!isAbsolute(path)) {
    throw new Error(
      `"${path}" is a relative path. It would resolve against this server's working directory rather than yours, so an absolute path is required.`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `${path} is ${Math.round(bytes.byteLength / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.`,
    );
  }

  const mimeType = detectMimeType(bytes);
  if (!mimeType) {
    throw new Error(
      `${path} is not a PNG, JPEG, GIF or WebP. The type is checked from the file's contents, not its extension.`,
    );
  }

  return {
    dataUri: `data:${mimeType};base64,${bytes.toString("base64")}`,
    mimeType,
    bytes: bytes.byteLength,
  };
}
