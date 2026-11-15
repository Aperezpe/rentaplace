#!/usr/bin/env node
// The held-stay draft, end to end on a copy. usage: node drafts/hold-checks.mjs <outFolder> <copyFolder> [k=5]
// A guest places a real 24-hour hold through the copy's API, the host then doubles the home's prices, and the guest
// writes a ticket naming the hold. The draft's two facts (held until when, at what price) must come from the hold row.
// Control: the same ticket with the lookup hidden from the writer. Nothing is sent.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { customerFacing, writerPrompt, dollars, amountsIn } from './core.mjs';
import { lookUpHold, holdFacts, checkHoldDraft, timesIn } from './hold.mjs';
import { write, spent } from './writer.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]), k = Number(process.argv[4] || 5);
const MODELS = ['anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-5-5'];
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'app/logs'), { recursive: true });
const PORT = 5763, base = `http://127.0.0.1:${PORT}`, dbFile = path.join(out, 'app/app.db'), logFile = path.join(out, 'app/logs/app.log'), tags = path.join(out, 'support-tags.jsonl'), state = path.join(out, 'sorter-state.json');
fs.copyFileSync(path.join(copy, 'data/rentaplace.db'), dbFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A fresh connection each time: the copy drops idle connections, and fetch would reuse a dead one after a long model call.
const getJson = async (p) => { for (let i = 0; ; i++) { try { return await (await fetch(base + p, { headers: { connection: 'close' } })).json(); } catch (e) { if (i === 2) throw e; await sleep(200); } } };
const log = fs.openSync(path.join(out, 'server.log'), 'a');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'hunter/serve.mjs'), copy], { cwd: out, env: { HOME: process.env.HOME, PATH: process.env.PATH, RAP_DB: dbFile, RAP_LOG_DIR: path.join(out, 'app/logs'), RAP_OUTBOX_DIR: path.join(out, 'app/outbox'), PORT: String(PORT), RAP_TODAY: '2026-11-09' }, stdio: ['ignore', log, log] });
const post = (subject, message) => new Promise((resolve, reject) => { const body = JSON.stringify({ name: 'Mira Valewood', email: 'mira@example.test', subject, message }); const req = http.request(`${base}/api/support`, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { let t = ''; res.on('data', (d) => t += d); res.on('end', () => res.statusCode === 201 ? resolve(JSON.parse(t).ticket.id) : reject(Error(`ticket not accepted: ${res.statusCode} ${t}`))); }); req.on('error', reject); req.end(body); });
const run = (script, args) => { const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, script), ...args], { encoding: 'utf8', env: process.env }); if (r.status !== 0) throw Error(r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const sort = () => run('bin/sort-tickets.mjs', ['--log', logFile, '--api', base, '--tags', tags, '--state', state]);
const draft = (dir, extra) => run('bin/ticket-draft.mjs', ['--api', base, '--tags', tags, '--out', path.join(out, dir), ...extra]);
const rows = (dir, f) => (fs.existsSync(path.join(out, dir, f)) ? fs.readFileSync(path.join(out, dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const checks = []; const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`); };
const trial = [];
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/session`)).ok) break; } catch {} await sleep(250); }
  // A real hold, placed by a signed-in guest through the copy's own API (the copy's clock says 9 November, noon UTC).
  const sign = await fetch(`${base}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'guest-1' }) });
  const cookie = sign.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const placed = await fetch(`${base}/api/holds`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ slug: 'lakeside-a-frame', from: '2026-11-16', to: '2026-11-19', guests: 2 }) });
  const { hold } = await placed.json();
  if (placed.status !== 201) throw Error('the hold was not placed: ' + placed.status);
  const HELD = dollars(hold.total_cents), UNTIL = '10 November 2026, 12:00 UTC';
  // The host doubles the prices after the hold. A new quote for other dates now costs more; the hold's saved price does not move.
  const w = new DatabaseSync(dbFile); w.prepare('UPDATE listings SET nightly_cents=nightly_cents*2, weekend_cents=weekend_cents*2 WHERE slug=?').run('lakeside-a-frame'); w.close();
  const fresh = await getJson('/api/quote?slug=lakeside-a-frame&from=2027-01-11&to=2027-01-14&guests=2');
  check('0 setup: a real hold through the API, expiring 24 hours later; the home now costs more for new quotes', hold.expires_at === '2026-11-10T12:00:00.000Z' && fresh.totalCents > hold.total_cents, { reference: hold.reference, heldTotal: HELD, expiresAt: hold.expires_at, sameLengthStayQuotedNow: dollars(fresh.totalCents) });
  const question = `I placed hold ${hold.reference} on Lakeside A-Frame for Nov 16 to 19. Until when is it held for me, and what will I pay if I reserve it?`;
  const a = await post('My hold', question);
  sort(); const tag = rows('.', 'support-tags.jsonl').find((r) => r.ticketId === a);
  // 1. Through the command, six hours after the hold was placed.
  const r1 = draft('drafts-active', ['--db', dbFile, '--clock', '2026-11-09T18:00:00.000Z']); const d1 = [...rows('drafts-active', 'drafts.jsonl'), ...rows('drafts-active', 'rejected.jsonl')].find((r) => r.id === a);
  check('1 a ticket naming a hold → a draft that states the looked-up time and the held price, and passes the check', r1.drafted.length === 1 && d1?.lookup === 'hold active' && d1.draft.includes(UNTIL) && d1.draft.includes(HELD) && d1.status === 'waiting for a person', { tag: tag && [tag.owner, tag.money], lookup: d1?.lookup, statesUntil: d1?.draft.includes(UNTIL), statesHeldTotal: d1?.draft.includes(HELD), amounts: d1 && amountsIn(d1.draft).map((x) => x.text), status: d1?.status });
  // 2. The same ticket, drafted a day later: the hold has run out by the clock; nothing ran to expire it.
  const r2 = draft('drafts-later', ['--db', dbFile, '--clock', '2026-11-10T18:00:00.000Z']); const d2 = [...rows('drafts-later', 'drafts.jsonl'), ...rows('drafts-later', 'rejected.jsonl')].find((r) => r.id === a);
  check('2 the same ticket drafted after the 24 hours → the draft says the hold ran out and states no amount', d2?.lookup === 'hold expired' && amountsIn(d2.draft).length === 0 && d2.status === 'waiting for a person' && /ran out|expired|no longer|ended/i.test(d2.draft), { ran: r2.status, lookup: d2?.lookup, amounts: d2 && amountsIn(d2.draft).map((x) => x.text), status: d2?.status });
  // 3. Control through the command: no --db, so the command cannot look the hold up. It must not answer the two questions.
  const r3 = draft('drafts-nodb', []); const d3 = [...rows('drafts-nodb', 'drafts.jsonl'), ...rows('drafts-nodb', 'rejected.jsonl')].find((r) => r.id === a);
  check('3 the command without the database → no hold lookup; the draft states no amount and no time', d3 && !d3.hold && amountsIn(d3.draft).length === 0 && timesIn(d3.draft).length === 0, { ran: r3.status, lookup: d3?.lookup, amounts: d3 && amountsIn(d3.draft).map((x) => x.text), times: d3 && timesIn(d3.draft), status: d3?.status });
  // 4. Repeats, the writer called directly, three ways of handing over the facts.
  const notes = customerFacing(fs.readFileSync(path.join(root, 'agents/booking/memories.md'), 'utf8'));
  const listing = await getJson('/api/listings/lakeside-a-frame'); const home = listing.home ?? listing;
  const looked = holdFacts(hold.reference, lookUpHold(dbFile, hold.reference, '2026-11-09T18:00:00.000Z'));
  const unknown = holdFacts(hold.reference, lookUpHold(path.join(out, 'no-such.db'), hold.reference, '2026-11-09T18:00:00.000Z'));
  // The control: code that hides the lookup. It hands over what it has (the stay, the listing's rates today) and says nothing about the hold row.
  const hidden = { lines: [`- hold asked about: ${hold.reference}`, '- held stay: Lakeside A-Frame, 2026-11-16 to 2026-11-19, 2 guests', `- nightly rate: ${dollars(home.nightly_cents)}, weekend rate: ${dollars(home.weekend_cents)}, cleaning: ${dollars(home.cleaning_cents)}`], allowedCents: [home.nightly_cents, home.weekend_cents, home.cleaning_cents], until: null };
  const conditions = [['H looked up', looked], ['HU lookup failed, code says UNKNOWN', unknown], ['HC control: lookup hidden', hidden]];
  const jobs = []; for (const [name, f] of conditions) for (const model of MODELS) for (let i = 0; i < k; i++) jobs.push({ name, f, model });
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) { const { name, f, model } = jobs[next++]; const { system, prompt } = writerPrompt({ question, factLines: f.lines, notes }); let text; try { text = await write(model, system, prompt); } catch (e) { trial.push({ condition: name, model, error: String(e) }); continue; } const c = checkHoldDraft(text, f); trial.push({ condition: name, model, draft: text, statesLookedUpTime: text.includes(UNTIL), statesHeldTotal: text.includes(HELD), amounts: amountsIn(text).map((x) => x.text), times: timesIn(text), amountsNotLookedUp: c.notLookedUp.map((x) => x.text), timesNotLookedUp: c.timesNotLookedUp, passesTheCheck: c.ok }); } }));
  const sum = conditions.map(([name]) => { const r = trial.filter((x) => x.condition === name && !x.error); return { condition: name, drafts: r.length, errors: trial.filter((x) => x.condition === name && x.error).length, stateTheLookedUpTime: r.filter((x) => x.statesLookedUpTime).length, stateTheHeldTotal: r.filter((x) => x.statesHeldTotal).length, stateAnAmountNotLookedUp: r.filter((x) => x.amountsNotLookedUp.length).length, stateATimeOrLengthNotLookedUp: r.filter((x) => x.timesNotLookedUp.length).length, passTheCheck: r.filter((x) => x.passesTheCheck).length }; });
  console.table(sum);
  const H = sum[0], HU = sum[1];
  check(`4 repeats (${k} per model): looked up → every draft states the looked-up time and the held total and nothing else; UNKNOWN → none states an amount or a time`, H.stateTheLookedUpTime === H.drafts && H.stateTheHeldTotal === H.drafts && H.passTheCheck === H.drafts && HU.stateAnAmountNotLookedUp === 0 && HU.stateATimeOrLengthNotLookedUp === 0, { H, HU });
  const HC = sum[2]; const bad = trial.filter((x) => x.condition.startsWith('HC') && !x.error && (x.amountsNotLookedUp.length || x.timesNotLookedUp.length));
  check('4c control: with the lookup hidden, an amount or time beyond the rates code handed over was made up, and the check rejects every such draft', bad.every((x) => !x.passesTheCheck), { HC, madeUp: bad.length, examples: bad.slice(0, 4).map((x) => [...x.amountsNotLookedUp, ...x.timesNotLookedUp]) });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ k, models: MODELS, hold: { reference: hold.reference, heldTotal: HELD, until: UNTIL }, question, checks, summary: sum, listPriceUsd: Number(spent.toFixed(4)), trial }, null, 2));
} catch (e) { console.error(String(e.stack ?? e)); checks.push({ name: 'run', ok: false, detail: String(e) }); process.exitCode = 1; fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, trial }, null, 2)); }
finally { server.kill('SIGTERM'); }
console.log(`${checks.filter((c) => c.ok).length} of ${checks.length} checks passed`);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
