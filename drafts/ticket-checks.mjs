#!/usr/bin/env node
// End-to-end checks for ticket → draft, on a copy of RentAPlace. usage: node drafts/ticket-checks.mjs <outFolder> <copyFolder> [model]
// Real tickets are posted to the copy's support API, sorted by the sorter, then drafted. Nothing is sent.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { spawn, spawnSync } from 'node:child_process'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]), model = process.argv[4] || 'anthropic/claude-haiku-5-5';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'app/logs'), { recursive: true });
const PORT = 5762, base = `http://127.0.0.1:${PORT}`, dbFile = path.join(out, 'app/app.db'), logFile = path.join(out, 'app/logs/app.log'), tags = path.join(out, 'support-tags.jsonl'), state = path.join(out, 'sorter-state.json');
fs.copyFileSync(path.join(copy, 'data/rentaplace.db'), dbFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
async function up() {
  const log = fs.openSync(path.join(out, 'server.log'), 'a');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'hunter/serve.mjs'), copy], { cwd: out, env: { HOME: process.env.HOME, PATH: process.env.PATH, RAP_DB: dbFile, RAP_LOG_DIR: path.join(out, 'app/logs'), RAP_OUTBOX_DIR: path.join(out, 'app/outbox'), PORT: String(PORT), RAP_TODAY: '2026-11-09' }, stdio: ['ignore', log, log] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/session`)).ok) return; } catch {} await sleep(250); }
  throw Error('the copy did not start');
}
async function down() { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); server = null; }
// A fresh connection per ticket: the copy drops idle connections, and fetch would reuse a dead one after a long model call (ECONNRESET).
const post = (subject, message) => new Promise((resolve, reject) => { const body = JSON.stringify({ name: 'Check Guest', email: 'check.guest@example.test', subject, message }); const req = http.request(`${base}/api/support`, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { let t = ''; res.on('data', (d) => t += d); res.on('end', () => res.statusCode === 201 ? resolve(JSON.parse(t).ticket.id) : reject(Error(`ticket not accepted: ${res.statusCode} ${t}`))); }); req.on('error', reject); req.end(body); });
const sort = () => { const r = spawnSync(process.execPath, [path.join(root, 'bin/sort-tickets.mjs'), '--log', logFile, '--api', base, '--tags', tags, '--state', state, '--model', model], { encoding: 'utf8', env: process.env }); if (r.status !== 0) throw Error(r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const tagRows = () => (fs.existsSync(tags) ? fs.readFileSync(tags, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// What the sorter must never change: every ticket, reservation and payout row in the product's database.
const digest = () => { const db = new DatabaseSync(dbFile, { readOnly: true }); const h = createHash('sha256'); for (const t of ['support_tickets', 'bookings', 'payouts']) h.update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())); db.close(); return h.digest('hex').slice(0, 16); };
const dOut = path.join(out, 'drafts-out');
const draft = () => { const r = spawnSync(process.execPath, [path.join(root, 'bin/ticket-draft.mjs'), '--api', base, '--tags', tags, '--out', dOut, '--model', model], { encoding: 'utf8', env: process.env }); if (r.status !== 0) throw Error(r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const rows = (f) => (fs.existsSync(path.join(dOut, f)) ? fs.readFileSync(path.join(dOut, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const amounts = (t) => t.match(/\$\s?\d[\d,.]*|\d[\d,.]*\s?(?:dollars|USD)/gi) ?? [];
const checks = []; const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`); };
try {
  await up();
  const quote = await (await fetch(`${base}/api/quote?slug=lakeside-a-frame&from=2026-11-16&to=2026-11-19&guests=2`)).json();
  const TOTAL = '$' + (quote.totalCents / 100).toFixed(2);
  // 0. Control: no sorted ticket → no draft.
  sort(); const r0 = draft();
  check('0 control: nothing sorted → no draft', r0.drafted.length === 0 && rows('drafts.jsonl').length === 0, r0);
  // 1. A ticket whose stay is written in full → one draft that states the looked-up total and no other amount.
  const a = await post('Price for Lakeside A-Frame', 'How much would Lakeside A-Frame be from 2026-11-16 to 2026-11-19 for 2 guests?');
  sort(); const r1 = draft(); const da = rows('drafts.jsonl').find((r) => r.id === a);
  check('1 stay written in full → one draft with the looked-up total, waiting for a person', r1.drafted.length === 1 && da && da.lookup === 'ok' && da.draft.includes(TOTAL) && amounts(da.draft).every((x) => da.facts.join(' ').includes(x.replace(/[.,]$/, ''))), { total: TOTAL, stay: da?.stay, owner: da?.owner, status: da?.status, amountsInDraft: da ? amounts(da.draft) : null });
  // 1b. Who signs: the sorter may say a price question is Pricing's; the draft is still written and signed by Booking,
  // and the row says who to ask when it is wrong. The two agree because the row carries both, on purpose.
  const tagA = readTags().find((r) => r.ticketId === a);
  check('1b the draft row says Booking wrote it, and names the tagged owner as who to ask if it is wrong', da && da.writtenBy === 'booking' && da.askIfWrong === tagA?.owner, { taggedOwner: tagA?.owner, writtenBy: da?.writtenBy, askIfWrong: da?.askIfWrong, signedAs: da?.draft.trim().split('\n').slice(-2).join(' / ') });
  // 2. The same ticket again: the sorter and the drafter run again, and the ticket's tag line is seen again → still one draft.
  sort(); const r2 = draft();
  fs.appendFileSync(tags, JSON.stringify({ ...JSON.parse(fs.readFileSync(tags, 'utf8').split('\n')[0]), at: 'again' }) + '\n');
  const r2b = draft();
  check('2 the same ticket ID again → still one draft', r2.drafted.length === 0 && r2b.drafted.length === 0 && rows('drafts.jsonl').filter((r) => r.id === a).length === 1, { secondRun: r2, tagSeenTwice: r2b });
  // 3. Dates without a year, five tickets: code does not read the stay; the draft says so and states no amount.
  const five = []; for (let i = 0; i < 5; i++) five.push(await post('Price for Lakeside A-Frame', 'How much would Lakeside A-Frame be for Nov 16 to 19, two of us? Is it free then?'));
  sort(); const r3 = draft(); const d3 = [...rows('drafts.jsonl'), ...rows('rejected.jsonl')].filter((r) => five.includes(r.id));
  const stated = d3.filter((r) => amounts(r.draft).length), asked = d3.filter((r) => /date|when/i.test(r.draft) && /\?|could you|let (me|us) know|please (send|share|confirm|tell)/i.test(r.draft));
  check('3 dates without a year (5 tickets) → stay not read, no quote looked up, no amount in any draft that waits', d3.length === 5 && d3.every((r) => r.stay === null && r.lookup.startsWith('not tried')) && rows('drafts.jsonl').filter((r) => five.includes(r.id)).every((r) => amounts(r.draft).length === 0), { drafts: d3.length, notRead: d3[0]?.stayNotRead, statedAnAmount: stated.length, rejectedByTheCheck: r3.rejected.length, askedForTheDates: asked.length });
  // 4. A ticket nobody owns → no draft.
  const n = await post('Pet policy question', 'Does the pet-friendly amenity include two small dogs?');
  sort(); const r4 = draft(); const nd = rows('no-draft.jsonl').find((r) => r.id === n);
  check('4 a ticket nobody owns → no draft, and the reason is written down', r4.drafted.length === 0 && nd && !rows('drafts.jsonl').some((r) => r.id === n), { tag: readTags().find((r) => r.ticketId === n), noDraft: nd });
  // 5. Copy down while a sorted ticket waits for its draft → offline, nothing written.
  const w = await post('Price for Pine Hollow Cabin', 'How much is pine-hollow-cabin from 2026-11-16 to 2026-11-19 for 2 guests?');
  sort(); await down(); const before = FILES();
  const r5 = draft();
  check('5 copy down → "offline", no draft written', r5.status === 'offline' && FILES() === before, r5);
  await up(); const r5b = draft(); const dw = [...rows('drafts.jsonl'), ...rows('rejected.jsonl')].find((r) => r.id === w);
  check('5b copy back → that ticket gets its one draft', r5b.drafted.length + r5b.rejected.length === 1 && dw, { lookup: dw?.lookup, stay: dw?.stay, status: dw?.status });
  // 6. Control: with the outcome files gone, the same tickets are drafted again. So the files are what stop a second draft.
  const count = rows('drafts.jsonl').length + rows('rejected.jsonl').length;
  fs.renameSync(dOut, dOut + '-kept'); const r6 = draft();
  check('6 control: outcome files removed → drafted again (the files are what stop a second draft)', r6.drafted.length + r6.rejected.length === count, { before: count, again: r6.drafted.length + r6.rejected.length });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ model, checks }, null, 1));
  console.log(`${checks.filter((c) => c.ok).length} of ${checks.length} checks passed`);
} finally { if (server) await down(); }
process.exit(checks.every((c) => c.ok) ? 0 : 1);
function readTags() { return tagRows(); }
function FILES() { return ['drafts.jsonl', 'rejected.jsonl', 'no-draft.jsonl'].map((f) => rows(f).length).join(','); }
