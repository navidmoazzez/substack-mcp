/**
 * Where a captured session lives on disk.
 *
 * `substack-mcp login` writes here so the cookie does not have to sit in a
 * client config file. The file is 0600 and encrypted with AES-256-GCM under a
 * key derived from this OS account plus this machine, which is never stored.
 *
 * Be honest about what that buys: a copied file is useless on another machine,
 * and a casual disk or backup read sees ciphertext. It is machine-binding and
 * obfuscation, not a secret vault. Code running as you on this machine can
 * re-derive the key. That is the same exposure as the environment-variable
 * path, which is why env vars remain a first-class, fully supported option.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";

export type StoredSession = {
  publication_url: string;
  session_token: string;
  user_id?: string;
  captured_at: string;
};

const MAGIC = "SBMCP1";

export function sessionHome(): string {
  return process.env.SUBSTACK_MCP_HOME || join(homedir(), ".substack-mcp");
}

export function sessionPath(): string {
  return join(sessionHome(), "session.json");
}

/**
 * Derive the encryption key from stable machine and account facts. Never
 * written anywhere, so the ciphertext cannot travel to another machine.
 */
function deriveKey(salt: Buffer): Buffer {
  const material = `${userInfo().username} ${hostname()} substack-mcp`;
  return scryptSync(material, salt, 32);
}

export function saveSession(session: StoredSession): string {
  const dir = sessionHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = [
    MAGIC,
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");

  const path = sessionPath();
  writeFileSync(path, payload, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Read the stored session, or null if there is none or it will not decrypt. */
export function loadSession(): StoredSession | null {
  const path = sessionPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf8").trim();
    const parts = raw.split(".");
    if (parts.length !== 5 || parts[0] !== MAGIC) return null;

    const salt = Buffer.from(parts[1]!, "base64");
    const iv = Buffer.from(parts[2]!, "base64");
    const tag = Buffer.from(parts[3]!, "base64");
    const ciphertext = Buffer.from(parts[4]!, "base64");

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(salt), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as StoredSession;
  } catch {
    // Wrong machine, wrong account, or a corrupt file. Treat as absent so the
    // env-var path still works rather than hard-failing startup.
    return null;
  }
}

export function sessionDir(): string {
  return dirname(sessionPath());
}
