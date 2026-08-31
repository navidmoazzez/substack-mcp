/**
 * Scheduling Notes.
 *
 * Substack schedules posts but not Notes: a Note publishes the instant you
 * write it. So the queue lives here, and a timer in this process publishes each
 * one when it comes due.
 *
 * The limit that follows from that is worth stating rather than hiding, and the
 * tool descriptions say it too: this only fires while the server is running. A
 * Note scheduled for 9am publishes at 9am if the machine is awake with the MCP
 * client open, and otherwise on the next start after that time. Anything that
 * has to go out on time regardless belongs on a server, which is what the HTTP
 * transport and the Docker image are for.
 *
 * A due Note is never dropped. If the process was down, it publishes late and
 * says so, because a late Note is nearly always better than a missing one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sessionHome } from "./auth/session.js";

export type ScheduledNote = {
  id: string;
  text: string;
  publish_at: string;
  publication_url: string;
  status: "scheduled" | "published" | "failed" | "canceled";
  created_at: string;
  published_at?: string;
  published_late?: boolean;
  note_id?: number;
  error?: string;
};

const FILENAME = "scheduled-notes.json";

function queuePath(): string {
  return join(sessionHome(), FILENAME);
}

function readQueue(): ScheduledNote[] {
  const path = queuePath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ScheduledNote[]) : [];
  } catch {
    // A corrupt queue must not take the server down. An unreadable file means
    // no scheduled notes, which is visible through list_scheduled_notes.
    return [];
  }
}

function writeQueue(notes: ScheduledNote[]): void {
  const dir = sessionHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(queuePath(), JSON.stringify(notes, null, 2), { mode: 0o600 });
}

export function listScheduled(status?: ScheduledNote["status"]): ScheduledNote[] {
  const notes = readQueue();
  const filtered = status ? notes.filter((n) => n.status === status) : notes;
  return filtered.sort((a, b) => a.publish_at.localeCompare(b.publish_at));
}

export function schedule(
  text: string,
  publishAt: Date,
  publicationUrl: string,
): ScheduledNote {
  const note: ScheduledNote = {
    id: randomUUID(),
    text,
    publish_at: publishAt.toISOString(),
    publication_url: publicationUrl,
    status: "scheduled",
    created_at: new Date().toISOString(),
  };
  const queue = readQueue();
  queue.push(note);
  writeQueue(queue);
  return note;
}

export function cancel(id: string): ScheduledNote | null {
  const queue = readQueue();
  const note = queue.find((n) => n.id === id && n.status === "scheduled");
  if (!note) return null;
  note.status = "canceled";
  writeQueue(queue);
  return note;
}

function markPublished(id: string, noteId: number | undefined, late: boolean): void {
  const queue = readQueue();
  const note = queue.find((n) => n.id === id);
  if (!note) return;
  note.status = "published";
  note.published_at = new Date().toISOString();
  note.note_id = noteId;
  note.published_late = late;
  writeQueue(queue);
}

function markFailed(id: string, error: string): void {
  const queue = readQueue();
  const note = queue.find((n) => n.id === id);
  if (!note) return;
  note.status = "failed";
  note.error = error;
  writeQueue(queue);
}

export type Publisher = (
  note: ScheduledNote,
) => Promise<{ id?: number }>;

/**
 * Run the queue. Started once when the server boots and then every minute.
 *
 * Publishing is serialised rather than run in parallel: several Notes coming
 * due together should go out in order, and firing them at once is the fastest
 * way to get rate limited.
 */
export async function drain(publish: Publisher): Promise<number> {
  const due = readQueue().filter(
    (n) => n.status === "scheduled" && new Date(n.publish_at).getTime() <= Date.now(),
  );

  let published = 0;
  for (const note of due) {
    const lateBy = Date.now() - new Date(note.publish_at).getTime();
    try {
      const result = await publish(note);
      markPublished(note.id, result.id, lateBy > 120_000);
      published++;
    } catch (error) {
      markFailed(note.id, (error as Error).message);
    }
  }
  return published;
}

export class NoteScheduler {
  private timer?: NodeJS.Timeout;
  private readonly publish: Publisher;

  constructor(publish: Publisher) {
    this.publish = publish;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    // Catch anything that came due while the process was down.
    void drain(this.publish).catch(() => undefined);
    this.timer = setInterval(() => {
      void drain(this.publish).catch(() => undefined);
    }, intervalMs);
    // Never hold the process open on this timer alone.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
