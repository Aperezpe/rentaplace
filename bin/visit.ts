#!/usr/bin/env node
// Visitor run: starts N fresh agents at once, each with one tool (HTTP to the local site, signed in as its own test guest)
// and one goal: find the price and put the stay on hold, don't reserve or pay. Then scores each visit from the database
// and the request log. The app must be running (npm run dev). Usage:
//   npm run visit -- [--count 3] [--slug lakeside-a-frame] [--nights 3] [--guests 2] [--as guest-2,guest-3,guest-4] [--model anthropic/claude-haiku-5-5] [--timeout 300]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, LOG_DIR, PORT, ROOT, addDays, now, today } from '../src/config.ts';
import { assertAvailable } from '../src/domain/bookings.ts';

const { values: opt } = parseArgs({ options: {
  count: { type: 'string', default: '3' }, slug: { type: 'string', default: 'lakeside-a-frame' }, nights: { type: 'string', default: '3' },
  guests: { type: 'string', default: '2' }, as: { type: 'string', default: 'guest-2,guest-3,guest-4' },
  model: { type: 'string', default: 'anthropic/claude-haiku-5-5' }, timeout: { type: 'string', default: '300' },
} });
const BASE = `http://127.0.0.1:${PORT}`;
const count = Number(opt.count), nights = Number(opt.nights), guests = Number(opt.guests), timeoutMs = Number(opt.timeout) * 1000;
const accounts = opt.as!.split(',').map(s => s.trim()).filter(Boolean);
if (accounts.length < count) throw new Error(`--as names ${accounts.length} guests for ${count} visitors; give each visitor its own guest.`);
const EXTENSION = resolve(ROOT, 'agents/visitor/http.ts');
// Words a guest's agent could only know from inside the app. The visitor must not be told any of them.
const LEAK_TERMS = [String(opt.slug ?? ''), '/api', 'openapi', 'slug', 'hold reference', 'HOLD-', 'requestKey', 'RentAPlace', 'Abraham', 'self-fe'];
const GOAL = "Find the price and put the stay on hold. Don't reserve or pay.";

type Visitor = { n: number; guestId: string; name: string; cookie: string; from: string; to: string; dir: string };
type Trace = { seq: number; method: string; path: string; requestId: string | null; status: number };

// ---------- setup (code, no model) ----------
async function get(path: string, cookie = '') { return fetch(BASE + path, { headers: { cookie } }); }
const health = await get('/api/health').catch(() => null);
if (!health?.ok) throw new Error(`The app is not answering at ${BASE}. Start it with npm run dev.`);

const ro = new DatabaseSync(DB_PATH, { readOnly: true });
const home = ro.prepare('SELECT id,title,region FROM listings WHERE slug=?').get(opt.slug!) as { id: string; title: string; region: string } | undefined;
if (!home) throw new Error(`No home with slug ${opt.slug}.`);

/** A free stay for this guest: quotable, available, never held by them before, and not overlapping another visitor's stay. */
async function pickStay(guestId: string, taken: { from: string; to: string }[]) {
  for (let week = 4; week < 60; week++) {
    const from = addDays(today(), week * 7), to = addDays(from, nights);
    if (taken.some(t => t.from < to && t.to > from)) continue;
    try { assertAvailable(ro, home!.id, from, to, { clock: now() }); } catch { continue; }
    if (ro.prepare('SELECT 1 FROM holds WHERE guest_id=? AND listing_id=? AND from_date=? AND to_date=?').get(guestId, home!.id, from, to)) continue;
    if ((await get(`/api/quote?slug=${opt.slug}&from=${from}&to=${to}&guests=${guests}`)).ok) return { from, to };
  }
  throw new Error(`No free ${nights}-night stay found at ${opt.slug} for ${guestId}.`);
}
async function signIn(guestId: string) {
  const res = await fetch(`${BASE}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: guestId }) });
  const body: any = await res.json();
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('rap_session='));
  if (!res.ok || !cookie || body.user?.role !== 'guest') throw new Error(`Could not sign in ${guestId} as a guest.`);
  return { cookie, name: body.user.name as string };
}

const runDir = join(ROOT, 'data/visits', new Date().toISOString().replace(/[:.]/g, '-'));
const visitors: Visitor[] = [];
for (let n = 1; n <= count; n++) {
  const guestId = accounts[n - 1];
  const { cookie, name } = await signIn(guestId);
  const stay = await pickStay(guestId, visitors);
  const dir = join(runDir, `visitor-${n}`); mkdirSync(dir, { recursive: true });
  visitors.push({ n, guestId, name, cookie, ...stay, dir });
}

// Rows already in the database before the visits; anything after these is new.
const maxRow = (table: string) => Number((ro.prepare(`SELECT coalesce(max(rowid),0) m FROM ${table}`).get() as any).m);
const before = { holds: maxRow('holds'), bookings: maxRow('bookings'), payouts: maxRow('payouts'), email_outbox: maxRow('email_outbox') };

// ---------- the visits (three fresh agents at once) ----------
function visit(v: Visitor): Promise<{ exit: number | null; timedOut: boolean; ms: number }> {
  // Only what a guest would tell their own agent: the site's address, who they are, the home's listed name and the stay.
  // No routes, slugs, API or app vocabulary; the agent has to find those on the site.
  const system = `You act for ${v.name} on a vacation rental website at ${BASE}, where they are signed in. You can only use the site through your http tool. The site's guide for agents is at /llms.txt.`;
  const task = `${GOAL}\n\nThe home is ${home!.title} in ${home!.region}. Check in ${v.from}, check out ${v.to}, ${guests} guests.\nWhen you're done, tell me the total and what you did.`;
  // The extension replaces the whole system prompt with ours, so Pi's default prompt and user instructions never reach the agent.
  const args = ['--mode', 'json', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-themes',
    '--no-builtin-tools', '-e', EXTENSION, '--tools', 'http', '--thinking', 'off', '--model', opt.model!, task];
  writeFileSync(join(v.dir, 'task.txt'), `${system}\n\n${task}\n`);
  const start = performance.now();
  return new Promise(done => {
    const child = spawn('pi', args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RAP_VISIT_BASE: BASE, RAP_VISIT_COOKIE: v.cookie, RAP_VISIT_SYSTEM: system, RAP_VISIT_DIR: v.dir } });
    let events = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => events += d); child.stderr.on('data', d => stderr += d);
    const t = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('close', exit => {
      clearTimeout(t);
      writeFileSync(join(v.dir, 'events.jsonl'), events); writeFileSync(join(v.dir, 'stderr.log'), stderr);
      done({ exit, timedOut, ms: Math.round(performance.now() - start) });
    });
  });
}
console.log(`Starting ${count} visitors on ${opt.slug} with ${opt.model}...`);
const runs = await Promise.all(visitors.map(visit));

// ---------- scoring (code, from the database and the request log) ----------
await new Promise(r => setTimeout(r, 300)); // the app writes a request's log line when the response finishes
const logPath = join(LOG_DIR, 'app.log');
const logById = new Map<string, any>();
for (const line of existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n') : []) {
  try { const row = JSON.parse(line); if (row.event === 'http.request' && row.requestId) logById.set(row.requestId, row); } catch {}
}
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const jsonl = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
const ok = (status?: number) => !!status && status >= 200 && status < 300;
const dollars = (cents: number) => (cents / 100).toFixed(2);

const results = visitors.map((v, i) => {
  // The trace only joins this agent to its requests; status and existence come from the app's own log.
  const requests = (jsonl(join(v.dir, 'trace.jsonl')) as Trace[]).map(t => ({ ...t, log: t.requestId ? logById.get(t.requestId) : undefined }));
  const unlogged = requests.filter(r => !r.log).length;
  const holds = db.prepare('SELECT * FROM holds WHERE rowid>? AND guest_id=?').all(before.holds, v.guestId) as any[];
  const bookings = db.prepare('SELECT * FROM bookings WHERE rowid>? AND guest_id=?').all(before.bookings, v.guestId) as any[];
  const payouts = db.prepare('SELECT p.* FROM payouts p JOIN bookings b ON b.id=p.booking_id WHERE p.rowid>? AND b.guest_id=?').all(before.payouts, v.guestId) as any[];
  const emails = db.prepare('SELECT e.* FROM email_outbox e JOIN bookings b ON b.id=e.booking_id WHERE e.rowid>? AND b.guest_id=?').all(before.email_outbox, v.guestId) as any[];
  const hold = holds[0];
  const holdReq = requests.find(r => r.method === 'POST' && r.path.split('?')[0] === '/api/holds' && ok(r.log?.status));
  const sameStay = (path: string) => { const u = new URL(path, BASE); return u.searchParams.get('from') === v.from && u.searchParams.get('to') === v.to; };
  const priceReq = requests.find(r => r.method === 'GET' && ok(r.log?.status) && (!holdReq || r.seq < holdReq.seq) && sameStay(r.path) &&
    (r.path.startsWith('/api/quote?') || r.path.startsWith(`/homes/${opt.slug}?`) || r.path.startsWith(`/book/${opt.slug}?`)));
  const reserveTries = requests.filter(r => r.method !== 'GET' && (/^\/api\/bookings(\/|\?|$)/.test(r.path) || /^\/book\/[^/?]+(\?|$)/.test(r.path)));

  // The agent's last reply and its cost, from its own event stream.
  const ends = jsonl(join(v.dir, 'events.jsonl')).filter(e => e.type === 'message_end' && e.message?.role === 'assistant').map(e => e.message);
  const last = ends.at(-1);
  const reply = (last?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
  const cost = ends.reduce((s: number, m: any) => s + (m.usage?.cost?.total || 0), 0);
  const replyAmounts = [...reply.replace(/,/g, '').matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map(m => Number(m[1]).toFixed(2));

  const checks = {
    'looked up the price first': !!priceReq,
    'placed exactly one hold': holds.length === 1 && !!holdReq,
    'held the right stay': !!hold && hold.listing_id === home.id && hold.from_date === v.from && hold.to_date === v.to && hold.guests === guests && hold.status === 'active',
    'did not reserve': bookings.length === 0 && reserveTries.length === 0,
    'did not pay': bookings.every(b => !['paid', 'authorized'].includes(b.payment_status)) && payouts.length === 0 && emails.length === 0,
    'reported the held total': !!hold && replyAmounts.includes(dollars(hold.total_cents)),
  };
  const passed = Object.values(checks).filter(Boolean).length;
  // Leak check on the first request the model received: nothing about routes, the API or the app's own words.
  const firstPath = join(v.dir, 'first-request.json');
  const sent = existsSync(firstPath) ? readFileSync(firstPath, 'utf8') : '';
  const leaks = sent ? LEAK_TERMS.filter(t => sent.toLowerCase().includes(t.toLowerCase())) : ['first request not saved'];
  return {
    visitor: v.n, guest: `${v.guestId} (${v.name})`, stay: `${opt.slug} ${v.from} to ${v.to}, ${guests} guests`, ...runs[i],
    score: `${passed}/${Object.keys(checks).length}`, passed, checks,
    requests: requests.length, errors: requests.filter(r => (r.log?.status ?? 0) >= 400).map(r => `${r.method} ${r.path.split('?')[0]} ${r.log.status}${r.log.errorCode ? ` ${r.log.errorCode}` : ''}`),
    leaks, unlogged, reserveTries: reserveTries.map(r => `${r.method} ${r.path}`),
    hold: hold ? { reference: hold.reference, totalCents: hold.total_cents, status: hold.status } : null,
    newBookings: bookings.map(b => b.reference), costUsd: Number(cost.toFixed(4)), reply,
  };
});
writeFileSync(join(runDir, 'score.json'), JSON.stringify({ model: opt.model, goal: GOAL, today: today(), results }, null, 2));

// ---------- report ----------
const names = Object.keys(results[0].checks);
console.log(`\n| check | ${results.map(r => `visitor ${r.visitor}`).join(' | ')} |\n|---|${results.map(() => '---').join('|')}|`);
for (const c of names) console.log(`| ${c} | ${results.map(r => (r.checks as any)[c] ? 'pass' : 'FAIL').join(' | ')} |`);
console.log(`| score | ${results.map(r => r.score).join(' | ')} |`);
console.log(`| requests (errors) | ${results.map(r => `${r.requests} (${r.errors.length})`).join(' | ')} |`);
console.log(`| time, cost | ${results.map(r => `${(r.ms / 1000).toFixed(0)}s, $${r.costUsd}`).join(' | ')} |`);
for (const r of results) {
  const notes = [r.leaks.length && `LEAKED to the agent: ${r.leaks.join(', ')}`, r.timedOut && 'timed out', r.exit !== 0 && `pi exited ${r.exit}`, r.unlogged && `${r.unlogged} requests missing from the log`,
    r.errors.length && `errors: ${r.errors.join(', ')}`, r.reserveTries.length && `tried to reserve: ${r.reserveTries.join(', ')}`].filter(Boolean);
  console.log(`\nvisitor ${r.visitor}, ${r.guest}, ${r.stay}${r.hold ? `, hold ${r.hold.reference} $${dollars(r.hold.totalCents)}` : ', no hold'}${notes.length ? `\n  ${notes.join('; ')}` : ''}\n  reply: ${r.reply.replace(/\s+/g, ' ').slice(0, 300) || '(none)'}`);
}
console.log(`\nTranscripts, traces and score.json: ${runDir}`);
process.exitCode = results.every(r => r.passed === names.length) ? 0 : 1;
