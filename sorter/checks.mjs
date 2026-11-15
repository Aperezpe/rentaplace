#!/usr/bin/env node
// End-to-end checks for the sorter on arrival, on a copy of RentAPlace. usage: node sorter/checks.mjs <outFolder> <copyFolder> [model]
// Real tickets are posted to the copy's own support form API; the sorter reads the copy's log and its inbox.
import fs from 'node:fs'; import path from 'node:path'; import { spawn, spawnSync } from 'node:child_process'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]), model = process.argv[4] || 'anthropic/claude-haiku-5-5';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'app/logs'), { recursive: true });
const PORT = 5761, base = `http://127.0.0.1:${PORT}`, dbFile = path.join(out, 'app/app.db'), logFile = path.join(out, 'app/logs/app.log'), tags = path.join(out, 'support-tags.jsonl'), state = path.join(out, 'sorter-state.json');
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
const post = async (subject, message) => { const r = await fetch(`${base}/api/support`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Check Guest', email: 'check.guest@example.test', subject, message }) }); if (r.status !== 201) throw Error(`ticket not accepted: ${r.status} ${await r.text()}`); return (await r.json()).ticket.id; };
const sort = () => { const r = spawnSync(process.execPath, [path.join(root, 'bin/sort-tickets.mjs'), '--log', logFile, '--api', base, '--tags', tags, '--state', state, '--model', model], { encoding: 'utf8', env: process.env }); if (r.status !== 0) throw Error(r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const tagRows = () => (fs.existsSync(tags) ? fs.readFileSync(tags, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// What the sorter must never change: every ticket, reservation and payout row in the product's database.
const digest = () => { const db = new DatabaseSync(dbFile, { readOnly: true }); const h = createHash('sha256'); for (const t of ['support_tickets', 'bookings', 'payouts']) h.update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())); db.close(); return h.digest('hex').slice(0, 16); };
const checks = []; const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`); };
try {
  await up();
  // 0. Control: nothing has arrived, nothing is tagged.
  const r0 = sort();
  check('0 control: no ticket arrived → nothing tagged', r0.tagged.length === 0 && tagRows().length === 0, { arrived: r0.arrived, tags: tagRows().length });
  // 1. Three tickets arrive; each gets one tag; the money ones wait for a person.
  const a = await post('Still waiting', 'I cancelled last Tuesday and nothing has come back to my card yet.');
  const b = await post('Update my arrival time', 'We will arrive after 9 pm. How do I let the host know?');
  const c = await post('Pet policy question', 'Does the pet-friendly amenity include two small dogs?');
  const before = digest();
  const r1 = sort(); const by = Object.fromEntries(tagRows().map((r) => [r.ticketId, r]));
  check('1 three tickets arrive → three tags, by ticket ID', r1.tagged.length === 3 && [a, b, c].every((id) => by[id]), { tagged: r1.tagged.map((r) => [r.owner, r.money, r.waitsFor ?? null]) });
  check('1b the money ticket is flagged and waits for a person; the others are not', by[a]?.money === true && by[a]?.waitsFor === 'a person' && by[b]?.money === false && by[c]?.money === false, { a: by[a], b: by[b], c: by[c] });
  // 2. Nothing new → nothing added.
  const r2 = sort();
  check('2 run again with nothing new → no new tag', r2.tagged.length === 0 && tagRows().length === 3, { arrived: r2.arrived, tags: tagRows().length });
  // 3. The same arrival twice: the log line is written again (a re-sent event), and the saved place is lost.
  fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), level: 'info', event: 'support.received', ticketId: a }) + '\n');
  const r3 = sort();
  fs.rmSync(state);
  const r3b = sort();
  check('3 the same ticket ID arriving again, and the whole log re-read after the saved place is lost → still one tag each', r3.tagged.length === 0 && r3b.tagged.length === 0 && tagRows().length === 3 && r3b.already === 3, { resent: { arrived: r3.arrived, already: r3.already }, rereadFromStart: { arrived: r3b.arrived, already: r3b.already }, tags: tagRows().length });
  // 4. The support API is down when a ticket is waiting: "offline", no tag; when it is back the ticket is tagged.
  const d = await post('Payout date question', 'My guest checked in yesterday. When is the payout scheduled?');
  const withAllFour = digest();
  await down();
  const r4 = sort();
  check('4 support API down → "offline", no tag, place not moved', r4.status === 'offline' && r4.tagged.length === 0 && tagRows().length === 3 && !tagRows().some((r) => r.ticketId === d), { status: r4.status, reason: r4.reason, tags: tagRows().length });
  await up();
  const r4b = sort(); const dTag = tagRows().find((r) => r.ticketId === d);
  check('4b API back → the waiting ticket is tagged once', r4b.tagged.length === 1 && dTag && tagRows().length === 4, { tag: dTag });
  // 5. The product is untouched by sorting: tickets, reservations and payouts are the same rows as before (compared from the moment the fourth ticket existed).
  const db = new DatabaseSync(dbFile, { readOnly: true }); const cats = db.prepare("SELECT category, owner_id, status, count(*) n FROM support_tickets WHERE id IN (?,?,?,?) GROUP BY 1,2,3").all(a, b, c, d); db.close();
  const afterSorts = digest();
  check('5 sorting changed no ticket, reservation or payout row', afterSorts === withAllFour && cats.length === 1 && cats[0].category === 'uncategorized' && cats[0].status === 'open' && cats[0].n === 4, { ticketsStill: cats, digestOnceAllFourTicketsExisted: withAllFour, digestAtEnd: afterSorts, digestBeforeFirstSort: before });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ model, checks, tags: tagRows() }, null, 1));
  console.log(`${checks.filter((c) => c.ok).length} of ${checks.length} checks passed`);
} finally { if (server) await down(); }
process.exit(checks.every((c) => c.ok) ? 0 : 1);
