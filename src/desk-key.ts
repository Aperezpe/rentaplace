// The desk's hold request key, built in code from the stay, never chosen by the model. Shared by the place_hold tool
// (agents/desk/tools.ts, which runs inside the model's process) and src/desk.ts, so it imports nothing but Node.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Same guest, home, dates and guest count: same key, so asking again returns the hold already placed. Anything different: another key. */
export function holdKey(stay: { guestId: string; slug: string; from: string; to: string; guests: number }) {
  return `desk-${createHash('sha256').update(JSON.stringify([stay.guestId, stay.slug, stay.from, stay.to, stay.guests])).digest('hex').slice(0, 32)}`;
}

/**
 * What a desk request's tools did, one JSON line each, written by tool code (never the model):
 * hold (a key that got a hold back: 201 placed, 200 the same hold again), passage (a rule passage returned, word for word),
 * miss (a rule topic the home publishes nothing on), hold_refused (place_hold blocked after rules were read)
 * and call (a price lookup, or a hold request that got no hold back: the model saw something to report).
 */
export type DeskEvent =
  | { type: 'hold'; key: string; status: number }
  | { type: 'passage'; passage: { id: string; slug: string; home: string; topic: string; label: string; text: string; link: string; updatedAt: string } }
  | { type: 'miss'; slug: string; topic: string }
  | { type: 'hold_refused'; slug: string }
  | { type: 'call'; tool: string; status: number };
const eventsFile = (dir: string, requestId: string) => join(dir, 'requests', `${requestId.replace(/[^\w-]/g, '')}.jsonl`);
export function recordEvent(dir: string, requestId: string, event: DeskEvent) {
  mkdirSync(join(dir, 'requests'), { recursive: true });
  appendFileSync(eventsFile(dir, requestId), JSON.stringify(event) + '\n');
}
export function eventsFor(dir: string, requestId: string): DeskEvent[] {
  const file = eventsFile(dir, requestId);
  if (!existsSync(file)) return [];
  // Lines written before events had a type are hold keys.
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { const e = JSON.parse(l); return e.type ? e : { type: 'hold', ...e }; });
}
export const recordHoldKey = (dir: string, requestId: string, key: string, status: number) => recordEvent(dir, requestId, { type: 'hold', key, status });
export function holdKeysFor(dir: string, requestId: string): string[] {
  return [...new Set(eventsFor(dir, requestId).flatMap(e => e.type === 'hold' ? [e.key] : []))];
}
