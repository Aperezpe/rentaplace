import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, PORT, ROOT, WATCHER_DIR, addDays, today } from './config.ts';
import { findTag } from './sorter.ts';

/**
 * Draft replies to pricing tickets, run by hand: `npm run draft -- <ticketId> ...`.
 * Code finds the stay and looks up every fact from the app; Booking (Haiku, no tools) only writes the words.
 * Drafts are saved to data/drafts/<ticketId>.json. Nothing is ever sent to the guest.
 */
export const DRAFTS_DIR = process.env.RAP_DRAFTS_DIR || resolve(ROOT, 'data/drafts');
export const BOOKING_MODEL = 'anthropic/claude-haiku-5-5';
const MEMORIES = resolve(ROOT, 'agents/booking/memories.md');

export type Fact = { fact: string; value?: string; unknown?: string };
export type Stay =
  | { kind: 'reservation'; via: string; reference: string }
  | { kind: 'quote'; slug: string; home: string; from: string; to: string; guests: number }
  | { kind: 'unknown'; reason: string };
export type Draft = { ticketId: string; question: { subject: string; message: string }; stay: Stay; facts: Fact[]; reply: string; model: string; at: string };

const FACTS = ['home', 'dates', 'nights', 'guests', 'availability', 'nightly rate', 'cleaning', 'service fee', 'taxes', 'total'];
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------- reading the stay out of the ticket (code, no model) ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (s: string) => /^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()];
const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Dates written as 2026-11-20, "Nov 20", "November 20", "20 Nov", or a range "Nov 20-23" / "Nov 20 to 23". The year is the next one on or after today. */
export function datesIn(text: string, on = today()): string[] {
  const iso = (m: number, d: number) => {
    const year = Number(on.slice(0, 4));
    const pad = (n: number) => String(n).padStart(2, '0');
    const at = (y: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const valid = (s: string) => !isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).getUTCDate() === d;
    const s = at(year) >= on ? at(year) : at(year + 1);
    return valid(s) ? s : null;
  };
  const found: { at: number; date: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) found.push({ at: m.index!, date: m[1] });
  for (const m of text.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:-|–|to|until|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b)?`, 'gi'))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const a = iso(month, Number(m[2])); if (a) found.push({ at: m.index!, date: a });
    if (m[3]) { const b = iso(month, Number(m[3])); if (b) found.push({ at: m.index! + 1, date: b }); }
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'gi'))) {
    const d = iso(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), Number(m[1])); if (d) found.push({ at: m.index!, date: d });
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.date).filter((d, i, all) => all.indexOf(d) === i);
}

export type Listing = { slug: string; title: string };

/** The one home the ticket names, by full title, slug, or the title without its last word ("Pine Hollow" for Pine Hollow Cabin) when only one title fits. */
export function homeIn(text: string, listings: Listing[]): { slug: string; title: string } | { reason: string } {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9-]+/g, ' ')} `;
  const byTitle = new Map<string, Listing[]>();
  for (const l of listings) byTitle.set(l.title.toLowerCase(), [...(byTitle.get(l.title.toLowerCase()) || []), l]);
  const names = new Map<string, string>(); // spoken name -> title
  for (const title of byTitle.keys()) {
    names.set(title.replace(/[^a-z0-9-]+/g, ' ').trim(), title);
    const words = title.split(/\s+/);
    if (words.length >= 3) {
      const short = words.slice(0, -1).join(' ').replace(/[^a-z0-9-]+/g, ' ').trim();
      names.set(short, names.has(short) && names.get(short) !== title ? '' : title);
    }
  }
  for (const l of listings) if (lower.includes(` ${l.slug} `)) return { slug: l.slug, title: l.title };
  const hits = [...names.entries()].filter(([name, title]) => title && lower.includes(` ${name} `)).sort((a, b) => b[0].length - a[0].length);
  const titles = [...new Set(hits.filter(([name]) => !hits.some(([other]) => other.length > name.length && other.includes(name))).map(([, title]) => title))];
  if (!titles.length) return { reason: 'the ticket names no home' };
  if (titles.length > 1) return { reason: `the ticket names more than one home (${titles.join(', ')})` };
  const homes = byTitle.get(titles[0])!;
  if (homes.length > 1) return { reason: `${homes.length} homes are called ${homes[0].title}; the ticket does not say which` };
  return { slug: homes[0].slug, title: homes[0].title };
}

export function guestsIn(text: string): number | null {
  const m = text.match(new RegExp(`\\b${NUM}\\s+(?:guests?|people|persons|adults|of us)\\b`, 'i'));
  return m ? num(m[1]) ?? null : null;
}

/** The quote stay: a home, dates (two dates, or one date and a number of nights), and a guest count. */
export function quoteStayIn(text: string, listings: Listing[], on = today()): Extract<Stay, { kind: 'quote' | 'unknown' }> {
  const home = homeIn(text, listings);
  const dates = datesIn(text, on);
  const nightsMatch = text.match(new RegExp(`\\b${NUM}\\s+nights?\\b`, 'i'));
  const nights = nightsMatch ? num(nightsMatch[1]) : undefined;
  const guests = guestsIn(text);
  const missing: string[] = [];
  if ('reason' in home) missing.push(home.reason);
  let from: string | undefined, to: string | undefined;
  if (dates.length >= 2) [from, to] = dates;
  else if (dates.length === 1 && nights) { from = dates[0]; to = addDays(from, nights); }
  else missing.push(dates.length ? 'one date but no second date or number of nights' : nights ? 'a number of nights but no check-in date' : 'no dates');
  if (!guests) missing.push('no guest count');
  if (missing.length) return { kind: 'unknown', reason: missing.join('; ') };
  return { kind: 'quote', slug: (home as Listing).slug, home: (home as Listing).title, from: from!, to: to!, guests: guests! };
}

// ---------- looking up the facts from the app ----------

type Get = (path: string) => Promise<{ status: number; body: any }>;
export const appGet = (base = `http://127.0.0.1:${PORT}`): Get => async path => {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const allUnknown = (reason: string): Fact[] => FACTS.map(fact => ({ fact, unknown: reason }));

export async function lookUp(ticketId: string, text: string, listings: Listing[], get: Get, on = today()): Promise<{ stay: Stay; facts: Fact[] }> {
  const res = await get(`/api/support/${encodeURIComponent(ticketId)}/stay`);
  if (res.status === 200 && res.body?.stay) {
    const s = res.body.stay;
    return {
      stay: { kind: 'reservation', via: s.via, reference: s.reference },
      facts: [
        { fact: 'reservation', value: `${s.reference} (${s.status})` },
        { fact: 'home', value: s.home },
        { fact: 'dates', value: `${s.from} to ${s.to} (checkout ${s.to})` },
        { fact: 'nights', value: String(s.nights) },
        { fact: 'guests', value: String(s.guests) },
        { fact: 'availability', value: s.datesHeld ? 'the dates are held by this reservation' : `the dates are not held: the reservation is ${s.status}` },
        { fact: 'nightly rate', value: `accommodation ${usd(s.accommodationCents)} for ${s.nights} nights, the price saved when reserved (the home's rate today: ${usd(s.currentNightlyCents)} weeknight, ${usd(s.currentWeekendCents)} Friday and Saturday)` },
        { fact: 'cleaning', value: usd(s.cleaningCents) },
        { fact: 'service fee', value: usd(s.serviceFeeCents) },
        { fact: 'taxes', value: usd(s.taxCents) },
        { fact: 'total', value: usd(s.totalCents) },
      ],
    };
  }
  if (res.status !== 404 || res.body?.error?.code !== 'NO_RESERVATION') {
    const why = `the app could not be asked about the reservation (${res.status} ${res.body?.error?.message ?? ''})`.trim();
    return { stay: { kind: 'unknown', reason: why }, facts: allUnknown(why) };
  }
  const noReservation = String(res.body.error.message);
  const stay = quoteStayIn(text, listings, on);
  if (stay.kind !== 'quote') {
    const reason = `${noReservation} No home + stay to quote: ${stay.reason}.`;
    return { stay: { kind: 'unknown', reason }, facts: allUnknown(reason) };
  }
  const base: Fact[] = [
    { fact: 'home', value: stay.home },
    { fact: 'dates', value: `${stay.from} to ${stay.to} (checkout ${stay.to})` },
    { fact: 'guests', value: String(stay.guests) },
  ];
  const q = await get(`/api/quote?slug=${encodeURIComponent(stay.slug)}&from=${stay.from}&to=${stay.to}&guests=${stay.guests}`);
  if (q.status !== 200) {
    const why = `the app gave no quote: ${q.body?.error?.message ?? `status ${q.status}`}`;
    return { stay, facts: [...base, { fact: 'nights', unknown: why }, { fact: 'availability', ...(q.status === 409 ? { value: `not available: ${q.body?.error?.message}` } : { unknown: why }) }, ...['nightly rate', 'cleaning', 'service fee', 'taxes', 'total'].map(fact => ({ fact, unknown: why }))] };
  }
  const b = q.body;
  const rates = [b.weeknightNights ? `${usd(b.weeknightCents)} weeknight x ${b.weeknightNights}` : null, b.weekendNights ? `${usd(b.weekendCents)} Friday and Saturday x ${b.weekendNights}` : null].filter(Boolean).join(', ');
  return {
    stay,
    facts: [...base,
      { fact: 'nights', value: String(b.nights) },
      { fact: 'availability', value: 'available for these dates (quote, nothing is held)' },
      { fact: 'nightly rate', value: `${rates}; accommodation ${usd(b.accommodationCents)}` },
      { fact: 'cleaning', value: usd(b.cleaningCents) },
      { fact: 'service fee', value: usd(b.serviceFeeCents) },
      { fact: 'taxes', value: usd(b.taxCents) },
      { fact: 'total', value: usd(b.totalCents) },
    ],
  };
}

// ---------- asking Booking for the words ----------

/** Only the "## Customer-facing" section; "## Internal engineering" never leaves this file. */
export function customerFacing(memories = readFileSync(MEMORIES, 'utf8')): string {
  const start = memories.indexOf('## Customer-facing');
  if (start < 0) throw new Error('agents/booking/memories.md has no "## Customer-facing" section');
  const next = memories.indexOf('\n## ', start + 1);
  return memories.slice(start, next < 0 ? undefined : next).trim();
}

export function bookingPrompt(question: { subject: string; message: string }, facts: Fact[], notes = customerFacing()) {
  const system = `You are Booking, drafting a reply to a RentAPlace guest. A person reviews every draft; nothing you write is sent by itself.
Use only the facts and the customer-facing notes below. Copy amounts and dates exactly as given; never calculate, add, convert or estimate a number.
When a fact is unknown, say plainly that you do not have it yet and that the team will check; never guess it.
Say "reservation", never "booking". Reply with the message to the guest only: a few short paragraphs, no subject line.

${notes}`;
  const user = `The guest's question:
Subject: ${question.subject}
Message: ${question.message}

Facts looked up by code:
${facts.map(f => `- ${f.fact}: ${f.value ?? `unknown (${f.unknown})`}`).join('\n')}`;
  return { system, user };
}

export const PI_ARGS = (system: string, user: string) => ['-p', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--thinking', 'off', '--model', BOOKING_MODEL, '--system-prompt', system, user];

export type Ask = (args: string[]) => Promise<string>;
export const askPi: Ask = args => new Promise((done, fail) => {
  const child = spawn('pi', args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  child.on('close', code => { clearTimeout(timer); code === 0 && out.trim() ? done(out.trim()) : fail(new Error(`Booking did not answer (exit ${code}): ${err.trim().slice(-300)}`)); });
});

// ---------- one ticket ----------

function readOnly<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

export const draftPath = (ticketId: string, dir = DRAFTS_DIR) => join(dir, `${ticketId.replace(/[^A-Za-z0-9-]/g, '')}.json`);

export async function draftTicket(ticketId: string, opts: { dbPath?: string; tagsDir?: string; draftsDir?: string; get?: Get; ask?: Ask; on?: string } = {}): Promise<Draft> {
  const { dbPath = DB_PATH, tagsDir = WATCHER_DIR, draftsDir = DRAFTS_DIR, get = appGet(), ask = askPi, on = today() } = opts;
  const { ticket, listings } = readOnly(dbPath, db => ({
    ticket: db.prepare('SELECT id, subject, message FROM support_tickets WHERE id=?').get(ticketId) as { subject: string; message: string } | undefined,
    listings: db.prepare("SELECT slug, title FROM listings WHERE status='active'").all() as Listing[],
  }));
  if (!ticket) throw new Error(`${ticketId}: no such ticket`);
  const tag = findTag(ticketId, tagsDir);
  if (!tag) throw new Error(`${ticketId}: not sorted yet, so it is not a pricing ticket`);
  if (tag.owner !== 'pricing') throw new Error(`${ticketId}: tagged ${tag.owner}, not pricing`);
  const question = { subject: ticket.subject, message: ticket.message };
  const { stay, facts } = await lookUp(ticketId, `${ticket.subject}\n${ticket.message}`, listings, get, on);
  const { system, user } = bookingPrompt(question, facts);
  const reply = await ask(PI_ARGS(system, user));
  const draft: Draft = { ticketId, question, stay, facts, reply, model: BOOKING_MODEL, at: new Date().toISOString() };
  mkdirSync(draftsDir, { recursive: true });
  const path = draftPath(ticketId, draftsDir), tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(draft, null, 2) + '\n');
  renameSync(tmp, path);
  return draft;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  if (!ids.length) { process.stderr.write('Usage: npm run draft -- <ticketId> [ticketId ...]\n'); process.exit(2); }
  let failed = 0;
  for (const id of ids) {
    try {
      const d = await draftTicket(id);
      const unknown = d.facts.filter(f => f.unknown).length;
      process.stdout.write(`${id}: draft saved to ${draftPath(id)} (${d.stay.kind}${unknown ? `, ${unknown} facts unknown` : ''})\n`);
    } catch (error: any) { failed++; process.stderr.write(`${error.message}\n`); }
  }
  process.exit(failed ? 1 : 0);
}
