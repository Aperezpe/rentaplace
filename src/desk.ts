// The guest desk: POST /desk. A small model answers a signed-in guest with exactly three tools (look up a price, read a
// home's rules, place a hold), each calling this app's own API with the guest's sign-in. It knows only the customer-facing
// half of Booking's memories. Whatever it cannot do becomes one line on a list for a person, and code writes that line.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DESK_DIR, ROOT, today } from './config.ts';
import { AppError } from './errors.ts';
import { log } from './log.ts';
import type { Account } from './types.ts';
import { eventsFor, holdKeysFor, type DeskEvent } from './desk-key.ts';
import { RULE_TOPICS } from './domain/rules.ts';
import { DeskGate } from './desk-limits.ts';
import type { Meter } from './desk-receipts.ts';

export const DESK_MODEL = 'anthropic/claude-haiku-5-5';
export const DESK_TOOLS = ['look_up_price', 'read_home_rules', 'place_hold'] as const;
export const DESK_TIMEOUT_MS = 90_000;
const EXTENSION = resolve(ROOT, 'agents/desk/tools.ts');
const MEMORIES = resolve(ROOT, 'agents/booking/memories.md');

/** The customer-facing section of Booking's memories, without the source citations (commits, files, cards) that end each line. */
export function customerFacingKnowledge(text = readFileSync(MEMORIES, 'utf8')): string[] {
  const section = text.split(/^## /m).find(part => part.startsWith('Customer-facing'));
  if (!section) throw new Error('Booking memories have no Customer-facing section.');
  return section.split('\n').filter(line => line.startsWith('- ')).map(line => line.replace(/\s*\([^()]*\)\s*$/, '').trim());
}

/**
 * The system prompt is the same for every visitor and every day, so the provider can reuse it from its cache.
 * Anything that changes per visit (who is asking, today's date, their message) goes in the user turn, message last.
 */
export function deskSystem(knowledge = customerFacingKnowledge()) {
  return [
    'You are the RentAPlace guest desk, answering one signed-in guest. Who they are and today\'s date come at the start of their turn.',
    'You can do exactly three things, each through its tool: look up the price of a stay, read a home\'s rules, and place a 24-hour hold on a stay. You cannot reserve, pay, cancel, release a hold, refund, change a stay, contact a host, or anything else.',
    'Rules: call read_home_rules once per topic the guest asks about. It returns one passage of that home\'s published rules; quote its text word for word in quotation marks and add nothing to it. If it returns no passage, do not mention that topic in your reply at all, not even that it is missing: the desk adds that sentence itself. Never say what other homes do. If the guest asks for a hold, call place_hold; if it is refused, tell them to ask for the hold in a new message.',
    'Use only what the tools return and the facts below. Never guess a price, a rule, a date or a home. Dates are YYYY-MM-DD; check-out is the day the guest leaves. A home is named by the last part of its page address, /homes/<slug>, or by its exact name.',
    'Facts:', ...knowledge,
    'Answer with only a JSON object: {"reply": "what you tell the guest, a few short sentences", "done": true or false}. done is true only when you fully did or answered everything the guest asked. If any part needs something you cannot do, or information you do not have, set done to false and say in reply what you did and what you could not do.',
  ].join('\n');
}

/** The model's verdict, or undefined when it did not answer in the shape asked for. */
export function parseAnswer(text: string): { reply: string; done: boolean } | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[0]);
    if (typeof value.reply !== 'string' || !value.reply.trim() || typeof value.done !== 'boolean') return undefined;
    return { reply: value.reply.trim(), done: value.done };
  } catch { return undefined; }
}

export type ForPersonWhy = 'the desk could not do it' | 'the desk failed' | 'the desk answer was unreadable' | 'no published rule';
/** One line on the list for a person. Code writes every field; the guest's words are quoted, not the model's. */
export function addForPerson(entry: { requestId: string; guestId: string; message: string; why: ForPersonWhy }, dir = DESK_DIR) {
  mkdirSync(dir, { recursive: true });
  const line = { at: new Date().toISOString(), requestId: entry.requestId, guestId: entry.guestId, why: entry.why, ask: entry.message.replace(/\s+/g, ' ').trim().slice(0, 300) };
  appendFileSync(join(dir, 'for-a-person.jsonl'), JSON.stringify(line) + '\n');
  log('desk.for_person', { requestId: entry.requestId, why: entry.why });
  return line;
}

/** The per-visit turn: who is asking and today's date, then the visitor's own message, always last. */
export function deskTurn(guest: Account, message: string) {
  return `Guest: ${guest.name}\nToday: ${today()}\n\nGuest's message:\n${message}`;
}

export type Usage = { costUsd: number; promptTokens?: number; cachedTokens?: number };
export type Ask = (input: { system: string; message: string; base: string; cookie: string; requestId: string; guestId: string; dir: string }) => Promise<string | ({ text: string } & Usage)>;

/** A fresh Pi process with no built-in tools, no context files and no extensions except the desk's three tools. */
/** JSON mode, so the reply comes with what it cost; the cost counts against the daily desk budget. */
export const askModel: Ask = ({ system, message, base, cookie, requestId, guestId, dir }) => new Promise((done, fail) => {
  const args = ['--mode', 'json', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-themes',
    '--no-builtin-tools', '-e', EXTENSION, '--tools', DESK_TOOLS.join(','), '--thinking', 'off', '--model', DESK_MODEL, message];
  const child = spawn('pi', args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DESK_BASE: base, DESK_COOKIE: cookie, DESK_REQUEST_ID: requestId, DESK_GUEST: guestId, DESK_DIR: dir, DESK_SYSTEM: system } });
  let out = '', err = '';
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  const t = setTimeout(() => { child.kill('SIGTERM'); fail(new Error('desk model timed out')); }, DESK_TIMEOUT_MS);
  child.on('error', e => { clearTimeout(t); fail(e); });
  child.on('close', code => {
    clearTimeout(t);
    // Prompt tokens are everything sent each turn: uncached input plus cache reads and writes. Summed over turns.
    let text = '', costUsd = 0, promptTokens = 0, cachedTokens = 0;
    for (const line of out.split('\n')) {
      let e: any; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'message_end' || e.message?.role !== 'assistant') continue;
      const u = e.message.usage ?? {};
      costUsd += u.cost?.total || 0;
      promptTokens += (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
      cachedTokens += u.cacheRead || 0;
      text = (e.message.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      if (e.message.errorMessage) err += e.message.errorMessage;
    }
    // A failed run still spent money: the cost rides on the error so it is still recorded.
    if (code === 0 && text.trim()) done({ text: text.trim(), costUsd, promptTokens, cachedTokens });
    else fail(Object.assign(new Error(`desk model exited ${code}: ${err.trim().slice(-200)}`), { costUsd, promptTokens, cachedTokens }));
  });
});

// ---------- the confirmation: built from what the product saved, never from the model ----------
export type Confirmation = { reference: string; home: string; slug: string; from: string; to: string; guests: number; totalCents: number; currency: 'USD'; status: string; expiresAt: string; placedAt: string; placedNow: boolean };
/**
 * The holds this desk request's place_hold calls got back, read from the holds table by the request keys code built.
 * placedNow is false when the hold was already placed by an earlier, identical request and this one returned it.
 */
export function savedHolds(db: DatabaseSync, requestId: string, guestId: string, dir = DESK_DIR, startedAt = ''): Confirmation[] {
  const keys = holdKeysFor(dir, requestId);
  if (!keys.length) return [];
  return (db.prepare(`SELECT h.rowid AS row,h.*,l.title,l.slug FROM holds h JOIN listings l ON l.id=h.listing_id WHERE h.guest_id=? AND h.request_key IN (${keys.map(() => '?').join(',')}) ORDER BY h.rowid`).all(guestId, ...keys) as any[])
    .map(h => ({ reference: h.reference, home: h.title, slug: h.slug, from: h.from_date, to: h.to_date, guests: h.guests, totalCents: h.total_cents, currency: 'USD', status: h.status, expiresAt: h.expires_at, placedAt: h.created_at, placedNow: !before(h.row) }));
  function before(rowid: number) { return startedAt !== '' && rowid <= Number(startedAt); }
}
const HOLD_REF = /\bHOLD-[0-9A-F]{8}\b/gi;
/** The reply names the total as money: $468, $468.00, $1,234.50, or the same with USD. */
function mentionsTotal(reply: string, cents: number) {
  const dollars = Math.floor(cents / 100), rest = cents % 100;
  const amount = `${dollars.toLocaleString('en-US')}${rest ? `\\.${String(rest).padStart(2, '0')}` : '(?:\\.00)?'}`.replace(/,/g, ',?');
  return new RegExp(`(?:\\$\\s?|USD\\s?)${amount}(?![\\d.,]*\\d)|(?<![\\d.,])${amount}\\s?USD`, 'i').test(reply);
}
/** With confirmations: the reply names each one's reference and total, and no other hold reference. Without: no hold reference at all. */
export function replyAgrees(reply: string, confirmations: Confirmation[]): boolean {
  const named = new Set((reply.match(HOLD_REF) ?? []).map(r => r.toUpperCase()));
  const saved = new Set(confirmations.map(c => c.reference.toUpperCase()));
  if ([...named].some(r => !saved.has(r))) return false;
  return confirmations.every(c => named.has(c.reference.toUpperCase()) && mentionsTotal(reply, c.totalCents));
}

// ---------- rule passages: sources and the "we don't know" path, from what the tools recorded ----------
type Passage = Extract<DeskEvent, { type: 'passage' }>['passage'];
const flat = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
/** Every passage the tools returned appears word for word in the reply. With no passage there is nothing to quote. */
export function replyAgreesWithSources(reply: string, sources: Passage[]) {
  return sources.every(p => flat(reply).includes(flat(p.text)));
}
/** The sentence code adds for each home with a topic it publishes nothing on: we don't know, and what the home does list. */
export function noRuleSentence(home: { title: string; amenities: string[] } | undefined, topics: string[]) {
  const labels = topics.map(t => RULE_TOPICS.find(x => x.id === t)?.label.toLowerCase() ?? 'that');
  const what = [...new Set(labels)].join(' or ');
  if (!home) return `This home's published rules don't cover ${what}, so we don't know.`;
  return `${home.title}'s published rules don't cover ${what}, so we don't know. What it lists: ${home.amenities.join(', ') || 'no amenities'}.`;
}

const FOLLOW_UP = 'A person on our team will follow up on the part I could not do.';

export async function desk(input: { message: unknown; guest: Account; cookie: string; base: string; requestId: string }, deps: { ask?: Ask; dir?: string; db?: DatabaseSync; gate?: DeskGate; meter?: Meter } = {}) {
  // Length, rate and budget are checked before the model runs; without a gate (unit tests) only emptiness is.
  const message = deps.gate ? deps.gate.admit(input.guest.id, input.message) : typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) throw new AppError(400, 'DESK_MESSAGE_EMPTY', 'Send a message for the desk.');
  // Every way out returns the confirmation, also when the model failed after a hold was already placed.
  const dir = deps.dir ?? DESK_DIR;
  // The last holds row before this message: a confirmed hold at or below it was placed earlier and only returned now.
  const lastRow = deps.db ? String((deps.db.prepare('SELECT coalesce(max(rowid),0) m FROM holds').get() as any).m) : '';
  // One way out for every path: code adds the "we don't know" sentences, writes at most one line for a person,
  // and attaches the hold confirmation and the rule passages the tools actually returned.
  const finish = (modelReply: string, modelDone: boolean, failure?: ForPersonWhy) => {
    const events = eventsFor(dir, input.requestId);
    const sources = [...new Map(events.flatMap(e => e.type === 'passage' ? [[e.passage.id, e.passage] as const] : [])).values()];
    const missesBySlug = new Map<string, string[]>();
    for (const e of events) if (e.type === 'miss') missesBySlug.set(e.slug, [...new Set([...(missesBySlug.get(e.slug) ?? []), e.topic])]);
    const sentences = [...missesBySlug].map(([slug, topics]) => {
      const row = deps.db?.prepare('SELECT title,amenities FROM listings WHERE slug=?').get(slug) as { title: string; amenities: string } | undefined;
      return noRuleSentence(row && { title: row.title, amenities: JSON.parse(row.amenities) }, topics);
    });
    // A hold refused because rules were read is the desk working as designed, not something a person must pick up:
    // code skips the model's done flag for that message instead of trusting it.
    const holdRefused = events.some(e => e.type === 'hold_refused');
    const why: ForPersonWhy | undefined = failure ?? (missesBySlug.size ? 'no published rule' : !modelDone && !holdRefused ? 'the desk could not do it' : undefined);
    if (why) addForPerson({ requestId: input.requestId, guestId: input.guest.id, message, why }, deps.dir);
    // Every rule topic missed and no other tool returned anything: the reply is only code's sentences, so the model's
    // own "we don't know" never doubles them. A mixed message keeps the model's reply.
    const onlyMisses = !failure && missesBySlug.size > 0 && events.every(e => e.type === 'miss');
    const reply = [...(onlyMisses ? [] : [modelReply]), ...sentences, ...(why ? [FOLLOW_UP] : [])].join(' ');
    const holds = deps.db ? savedHolds(deps.db, input.requestId, input.guest.id, dir, lastRow) : [];
    const confirmation = holds.length === 0 ? null : holds.length === 1 ? holds[0] : holds;
    return { reply, done: !why, forAPerson: !!why, requestId: input.requestId, confirmation, replyAgreesWithConfirmation: replyAgrees(reply, holds),
      sources, replyAgreesWithSources: replyAgreesWithSources(reply, sources), holdRefusedAfterRules: holdRefused };
  };
  const used = (u: Partial<Usage>) => { if (deps.meter) Object.assign(deps.meter, { costUsd: u.costUsd ?? 0, promptTokens: u.promptTokens ?? 0, cachedTokens: u.cachedTokens ?? 0 }); };
  if (deps.meter) deps.meter.modelStarted = true;
  let text: string;
  try {
    const answer = await (deps.ask ?? askModel)({ system: deskSystem(), message: deskTurn(input.guest, message), base: input.base, cookie: input.cookie, requestId: input.requestId, guestId: input.guest.id, dir });
    text = typeof answer === 'string' ? answer : answer.text;
    deps.gate?.record(input.requestId, input.guest.id, typeof answer === 'string' ? 0 : answer.costUsd);
    used(typeof answer === 'string' ? {} : answer);
  } catch (error) {
    used((error as any) ?? {});
    if (deps.meter) deps.meter.failed = true;
    deps.gate?.record(input.requestId, input.guest.id, (error as any)?.costUsd ?? 0);
    log('desk.failed', { requestId: input.requestId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return finish('Sorry, I could not handle that just now.', false, 'the desk failed');
  }
  const answer = parseAnswer(text);
  if (!answer) {
    if (deps.meter) deps.meter.failed = true;
    return finish('Sorry, I could not handle that just now.', false, 'the desk answer was unreadable');
  }
  return finish(answer.reply, answer.done);
}
