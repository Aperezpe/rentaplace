import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, WATCHER_DIR } from './config.ts';
import { callJev, parseJev } from './jev.ts';

/** Thrown when no tag could be written. The watcher keeps the bookmark where it is and tries again later. */
export class SorterOffline extends Error {}

export type Tag = { ticketId: string; owner: string; money: boolean; unsure: boolean; why: string[]; moneyP: number; ownerConfidence: number; model: string; at: string };

export const tagsPath = (dir: string = WATCHER_DIR) => join(dir, 'support-tags.jsonl');

export function findTag(ticketId: string, dir: string = WATCHER_DIR): Tag | null {
  if (!existsSync(tagsPath(dir))) return null;
  for (const line of readFileSync(tagsPath(dir), 'utf8').split('\n')) {
    try { const tag = JSON.parse(line); if (tag.ticketId === ticketId) return tag; } catch {}
  }
  return null;
}

/** Read only: the sorter never changes the ticket. */
function readTicket(ticketId: string, dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare('SELECT subject, message FROM support_tickets WHERE id = ?').get(ticketId) as { subject: string; message: string } | undefined; }
  finally { db.close(); }
}

/** Tags one ticket with Jev. Repeat-safe: an existing tag means no model call and no second write. */
export async function sortTicket(ticketId: string, dir: string = WATCHER_DIR, dbPath: string = DB_PATH): Promise<{ tag: Tag; skipped: boolean }> {
  const existing = findTag(ticketId, dir);
  if (existing) return { tag: existing, skipped: true };
  const ticket = readTicket(ticketId, dbPath);
  if (!ticket) throw new SorterOffline(`ticket ${ticketId} not found in ${dbPath}`);
  const call = await callJev(ticket);
  if (!call.ok) throw new SorterOffline(`Jev unreachable: ${call.status ?? 'no response'} ${call.error ?? ''}`.trim());
  const answer = parseJev(call.raw);
  if (!answer.valid) throw new SorterOffline(`Jev answer invalid: ${answer.reason}`);
  const tag: Tag = { ticketId, owner: answer.owner, money: answer.money, unsure: answer.unsure, why: answer.why, moneyP: answer.moneyP, ownerConfidence: answer.ownerConfidence, model: call.modelReported || 'unknown', at: new Date().toISOString() };
  mkdirSync(dir, { recursive: true });
  appendFileSync(tagsPath(dir), JSON.stringify(tag) + '\n');
  return { tag, skipped: false };
}
