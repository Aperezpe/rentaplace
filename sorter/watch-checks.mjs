#!/usr/bin/env node
// "Sorted on arrival", checked on a copy of RentAPlace with the sorter left running in watch mode.
//   node sorter/watch-checks.mjs <outFolder> <copyFolder> [model=anthropic/claude-haiku-5-5 | jev] [watchSeconds=3]
// This script starts the copy and ONE long-running `bin/sort-tickets.mjs --watch`, then only posts tickets to the copy's
// own support API and reads the tags file. It never runs a sort itself: every tag here was written by the watcher.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]), model = process.argv[4] || 'anthropic/claude-haiku-5-5', every = Number(process.argv[5] || 3);
// How long one answer may take on top of the watch interval before the check calls it late (measured times are reported either way).
const answerBudgetMs = model === 'jev' ? 2000 : 30000;
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'app/logs'), { recursive: true });
const PORT = Number(process.env.WATCH_CHECK_PORT || 5762), base = `http://127.0.0.1:${PORT}`, dbFile = path.join(out, 'app/app.db'), logFile = path.join(out, 'app/logs/app.log'), tags = path.join(out, 'support-tags.jsonl'), state = path.join(out, 'sorter-state.json');
fs.copyFileSync(path.join(copy, 'data/rentaplace.db'), dbFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); const clock = () => +((Date.now() - t0) / 1000).toFixed(2);
const events = []; const note = (what, more = {}) => { events.push({ t: clock(), what, ...more }); };

let server = null;
async function up() {
  const log = fs.openSync(path.join(out, 'server.log'), 'a');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'hunter/serve.mjs'), copy], { cwd: out, env: { HOME: process.env.HOME, PATH: process.env.PATH, RAP_DB: dbFile, RAP_LOG_DIR: path.join(out, 'app/logs'), RAP_OUTBOX_DIR: path.join(out, 'app/outbox'), PORT: String(PORT), RAP_TODAY: '2026-11-09' }, stdio: ['ignore', log, log] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/session`)).ok) { note('support API up'); return; } } catch {} await sleep(250); }
  throw Error('the copy did not start');
}
async function down() { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); server = null; note('support API down'); }

// The watcher: one long-running process. Each line it prints is one pass; kept with the time it was seen.
let watcher = null; const passes = [];
function startWatcher() {
  watcher = spawn(process.execPath, [path.join(root, 'bin/sort-tickets.mjs'), '--log', logFile, '--api', base, '--tags', tags, '--state', state, '--model', model, '--watch', String(every)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = watcher.pid; let buf = '';
  watcher.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const text = buf.slice(0, i); buf = buf.slice(i + 1); fs.appendFileSync(path.join(out, 'watcher.log'), `${clock()} pid ${pid} ${text}\n`); try { passes.push({ t: clock(), pid, ...JSON.parse(text) }); } catch {} } });
  watcher.stderr.on('data', (d) => fs.appendFileSync(path.join(out, 'watcher.err'), d));
  note('watcher started', { pid, everySeconds: every });
}
async function killWatcher() { const w = watcher; watcher = null; w.kill('SIGKILL'); await new Promise((r) => w.once('exit', r)); note('watcher killed (SIGKILL)', { pid: w.pid }); }
/** Wait for the next pass line that satisfies `ok` (default: any). */
async function nextPass(ok = () => true, ms = 60000) { const from = passes.length; const until = Date.now() + ms; while (Date.now() < until) { const p = passes.slice(from).find(ok); if (p) return p; await sleep(50); } throw Error('no such pass within ' + ms + ' ms'); }

// A fresh connection per ticket (the copy drops idle connections).
const post = (subject, message) => new Promise((resolve, reject) => { const body = JSON.stringify({ name: 'Check Guest', email: 'check.guest@example.test', subject, message }); const req = http.request(`${base}/api/support`, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { let t = ''; res.on('data', (d) => t += d); res.on('end', () => { if (res.statusCode !== 201) return reject(Error(`ticket not accepted: ${res.statusCode} ${t}`)); const id = JSON.parse(t).ticket.id; note('ticket posted', { id, subject }); resolve({ id, at: Date.now() }); }); }); req.on('error', reject); req.end(body); });
const tagRows = () => (fs.existsSync(tags) ? fs.readFileSync(tags, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Poll the tags file until this ticket has a tag; returns seconds since `since`, or null when it never came. */
async function tagged(id, since, ms = every * 1000 + answerBudgetMs + 5000) { const until = Date.now() + ms; while (Date.now() < until) { if (tagRows().some((r) => r.ticketId === id)) { const s = +((Date.now() - since) / 1000).toFixed(2); note('tag seen', { id, secondsAfter: s }); return s; } await sleep(50); } return null; }
const digest = () => { const db = new DatabaseSync(dbFile, { readOnly: true }); const h = createHash('sha256'); for (const t of ['support_tickets', 'bookings', 'payouts']) h.update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())); db.close(); return h.digest('hex').slice(0, 16); };
const checks = []; const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`); };
const limit = +(every + answerBudgetMs / 1000).toFixed(1); // seconds: one watch interval plus one answer
const count = (id) => tagRows().filter((r) => r.ticketId === id).length;

try {
  await up(); startWatcher();
  // 0. Control: the watcher is running and nothing has arrived → passes happen, nothing is tagged.
  await nextPass(); await nextPass();
  check('0 control: watcher running, no ticket arrived → passes with nothing tagged', passes.length >= 2 && passes.every((p) => p.arrived === 0 && p.tagged.length === 0) && tagRows().length === 0, { passes: passes.length, tags: tagRows().length });

  // 1. Tickets arrive one at a time, at intervals. Nobody runs a sort. Each gets its tag from the watcher.
  const arrivals = []; const want = {};
  for (const [subject, message, money] of [['Refund timing', 'I cancelled a flexible stay yesterday. When will the refund show up?', true], ['Update my arrival time', 'We will arrive after 9 pm. How do I let the host know?', false], ['Pet policy question', 'Does the pet-friendly amenity include two small dogs?', false]]) {
    const p = await post(subject, message); want[p.id] = money;
    arrivals.push({ id: p.id, subject, seconds: await tagged(p.id, p.at) });
    await sleep((every + 1) * 1000);
  }
  const [a, b, c] = arrivals.map((x) => x.id);
  check(`1 three tickets posted ${every + 1} s apart, no sort command run → each tagged by the watcher within ${limit} s (the ${every} s interval plus one answer)`, arrivals.every((x) => x.seconds !== null && x.seconds <= limit) && tagRows().length === 3, { secondsFromPostToTag: arrivals.map((x) => x.seconds), limit });
  const by = () => Object.fromEntries(tagRows().map((r) => [r.ticketId, r]));
  check('1b the money ticket is flagged and waits for a person; the other two are not money', by()[a]?.money === true && by()[a]?.waitsFor === 'a person' && by()[b]?.money === false && by()[c]?.money === false, { tags: [a, b, c].map((id) => { const r = by()[id]; return r && [r.owner, r.money, r.waitsFor ?? null, r.unsure ?? false]; }) });
  const stateAfterThree = fs.readFileSync(state, 'utf8');

  // 2. The same ticket ID arrives twice: its `support.received` line is written to the log again (a re-sent event).
  fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), level: 'info', event: 'support.received', ticketId: a }) + '\n'); note('the arrival line for the first ticket written to the log again', { id: a });
  const again = await nextPass((p) => p.arrived >= 1);
  check('2 the same ticket ID arriving twice → the watcher sees it, still one tag', again.already === 1 && again.tagged.length === 0 && count(a) === 1 && tagRows().length === 3, { pass: { arrived: again.arrived, already: again.already, tagged: again.tagged.length }, tagsForThatTicket: count(a), tags: tagRows().length });

  // 3. The support API is unreachable for a while. A ticket arrives just before it goes down (right after a pass, so the watcher is asleep).
  await nextPass(); const beforeDown = passes.length;
  const d = await post('Payout date question', 'My guest checked in yesterday. When is the payout scheduled?'); want[d.id] = true;
  await down();
  const sneaked = passes.slice(beforeDown).some((p) => p.status === 'ok' && p.arrived > 0);
  const off1 = await nextPass((p) => p.status === 'offline'); const off2 = await nextPass((p) => p.status === 'offline'); const off3 = await nextPass((p) => p.status === 'offline');
  const placeWhileDown = fs.readFileSync(state, 'utf8');
  check('3 support API down with a ticket waiting → the watcher keeps running and says "offline" each pass, writes no tag, and does not move its place', !sneaked && [off1, off2, off3].every((p) => p.tagged.length === 0 && p.offset === off1.offset) && count(d.id) === 0 && tagRows().length === 3 && watcher.exitCode === null, { offlinePasses: passes.filter((p) => p.status === 'offline').length, reason: off1.reason, tags: tagRows().length, watcherStillRunning: watcher.exitCode === null, ...(sneaked ? { inconclusive: 'a pass ran between the post and the API going down' } : {}) });
  await up(); const backAt = Date.now();
  const dSeconds = await tagged(d.id, backAt);
  check(`3b API back → the waiting ticket is tagged within ${limit} s, once; nothing was lost`, dSeconds !== null && dSeconds <= limit && count(d.id) === 1 && tagRows().length === 4 && fs.readFileSync(state, 'utf8') !== placeWhileDown, { secondsFromApiBackToTag: dSeconds, secondsFromPostToTag: +((Date.now() - d.at) / 1000).toFixed(1), tag: by()[d.id] && [by()[d.id].owner, by()[d.id].money] });

  // 4. The watcher process is killed. Two tickets arrive while nothing is running. It is started again.
  await nextPass(); await killWatcher();
  const e = await post('Total looks wrong', 'The total at checkout was more than three times the nightly rate. What are the extra amounts?'); want[e.id] = true;
  const f = await post('Unable to find my confirmation', 'I booked a cabin but cannot find the confirmation in my inbox.'); want[f.id] = false;
  const withAllSix = digest();
  await sleep((every * 2) * 1000);
  const whileDead = tagRows().length;
  startWatcher(); const restartAt = Date.now();
  const eS = await tagged(e.id, restartAt, 2 * answerBudgetMs + 10000), fS = await tagged(f.id, restartAt, 2 * answerBudgetMs + 10000);
  check('4 watcher killed, two tickets arrive while nothing runs (no tag while it is dead), watcher started again → both tagged, once each', whileDead === 4 && eS !== null && fS !== null && count(e.id) === 1 && count(f.id) === 1 && tagRows().length === 6, { tagsWhileDead: whileDead, secondsFromRestartToTag: [eS, fS], tags: tagRows().length });

  // 5. Killed between writing a tag and saving its place: the saved place is put back to where it was after the third ticket, then the watcher is started again.
  await nextPass(); await killWatcher();
  fs.writeFileSync(state, stateAfterThree); note('saved place put back to an older one', { state: stateAfterThree });
  const linesBefore = fs.readFileSync(tags, 'utf8');
  startWatcher();
  const reread = await nextPass((p) => p.arrived >= 1);
  await nextPass();
  check('5 watcher killed and its saved place put back (as if it died after tagging, before saving) → it reads those arrivals again and adds no tag', reread.tagged.length === 0 && reread.already >= 3 && fs.readFileSync(tags, 'utf8') === linesBefore, { pass: { arrived: reread.arrived, already: reread.already, tagged: reread.tagged.length }, tags: tagRows().length });

  // 6. The whole run: one tag per ticket posted, none missing, none doubled; the product's rows are untouched by sorting.
  const ids = Object.keys(want); const rows = tagRows();
  check('6 every ticket posted has exactly one tag; no tag for anything else', ids.every((id) => count(id) === 1) && rows.length === ids.length && new Set(rows.map((r) => r.ticketId)).size === rows.length, { posted: ids.length, tags: rows.length, moneyAsExpected: ids.filter((id) => by()[id]?.money === want[id]).length });
  check('7 sorting changed no ticket, reservation or payout row', digest() === withAllSix, { digestOnceAllSixTicketsExisted: withAllSix, digestAtEnd: digest() });
  const pids = [...new Set(passes.map((p) => p.pid))];
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ model, watchSeconds: every, limitSeconds: limit, checks, tags: rows, watcherProcesses: pids.length, passes: passes.length, passesByStatus: { ok: passes.filter((p) => p.status === 'ok').length, offline: passes.filter((p) => p.status === 'offline').length }, events }, null, 1));
  console.log(`${checks.filter((c) => c.ok).length} of ${checks.length} checks passed  (${passes.length} watcher passes, ${pids.length} watcher processes, ${clock()} s)`);
} finally { if (watcher) await killWatcher(); if (server) await down(); }
process.exit(checks.length >= 10 && checks.every((c) => c.ok) ? 0 : 1);
