#!/usr/bin/env node
// The host checks, end to end, with real model calls (a few cents). Each check can fail.
// usage: node hunter/checks.mjs <outFolder> <brokenCopyFolder>     (make the copy with planted/make-broken-copy.mjs)
// Two servers run the broken copy: "source" is the app whose log is watched; "repro" is the copy the hunter replays on,
// so the hunter's own failing replays do not wake more hunts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
const here = import.meta.dirname;
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(24).toString('hex'), HOST_PORT = Number(process.env.HOST_PORT || 5723);
const hostUrl = `http://127.0.0.1:${HOST_PORT}`;
const FAIL = '/api/quote?slug=lakeside-a-frame&from=2026-11-29&to=2026-12-02&guests=2';
const delay = (n) => new Promise((r) => setTimeout(r, n));
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(JSON.stringify(checks.at(-1))); if (!ok) throw Error('FAILED: ' + name); };
const until = async (fn, label, max = 240000) => { const t = Date.now(); while (Date.now() - t < max) { const x = await fn(); if (x) return x; await delay(100); } throw Error('timed out: ' + label); };
const kids = new Set();
const start = (name, args, env) => { const log = fs.openSync(path.join(out, name + '.log'), 'a'); const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { cwd: out, env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env }, stdio: ['ignore', log, log] }); kids.add(child); child.once('exit', () => kids.delete(child)); return child; };
const kill = async (child, signal = 'SIGKILL') => { if (child.exitCode !== null || child.signalCode) return; const gone = new Promise((r) => child.once('exit', r)); child.kill(signal); await gone; };
async function app(name, port) {
  const dir = path.join(out, name); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(copy, 'data/rentaplace.db'), path.join(dir, 'app.db'));
  const child = start(name, [path.join(here, 'serve.mjs'), copy], { RAP_DB: path.join(dir, 'app.db'), RAP_LOG_DIR: path.join(dir, 'logs'), RAP_OUTBOX_DIR: path.join(dir, 'outbox'), PORT: String(port), RAP_TODAY: '2026-11-09' });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, name + ' start', 15000);
  return { base, child, log: path.join(dir, 'logs/app.log') };
}
let host, watcher, db;
const bootHost = async (repro) => {
  host = start('host', [path.join(here, 'host.ts')], { HUNT_BASE: repro.base, HUNT_OUT: out, HUNT_ROLE: path.join(here, 'job.md'), HUNT_TOKEN: token, HUNT_PORT: String(HOST_PORT), HUNT_CAP: process.env.HUNT_CAP || '3', HUNT_MODEL: process.env.HUNT_MODEL || 'anthropic/claude-haiku-5-5', ...(process.env.HUNT_PI_AUTH ? { HUNT_PI_AUTH: process.env.HUNT_PI_AUTH } : {}) });
  await until(async () => { if (host.exitCode !== null) throw Error('host exited'); try { return (await fetch(hostUrl + '/x')).status === 404; } catch { return false; } }, 'host start', 30000);
};
const bootWatcher = (source, extra = {}) => { watcher = start('watcher', [path.join(here, 'watcher.mjs')], { HUNT_LOG: source.log, HUNT_STATE: path.join(out, 'watcher-state.json'), HUNT_HOST: hostUrl, HUNT_TOKEN: token, ...extra }); };
const q = (sql, ...a) => db.prepare(sql).all(...a);
const n = (sql, ...a) => Number(Object.values(q(sql, ...a)[0])[0]);
const reportOf = (id) => { const r = q('select json from reports where id=?', id)[0]; return r && JSON.parse(r.json); };
const wake = (payload, auth = true) => fetch(hostUrl + '/wake', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
try {
  const source = await app('source', 5721), repro = await app('repro', 5722);
  await bootHost(repro);
  db = new DatabaseSync(path.join(out, 'host.db'), { readOnly: true });
  const failOnce = async () => { const r = await fetch(source.base + FAIL); if (r.status !== 500) throw Error('the planted bug did not fail: ' + r.status); return r.headers.get('x-request-id'); };

  const bad = await wake({}, false);
  check('1 a wake without the token is refused and starts nothing', bad.status === 401 && n('select count(*) from hunts') === 0, { http: bad.status });

  bootWatcher(source);
  const a = await failOnce();
  await until(() => reportOf(a), 'report for the first error');
  const ra = reportOf(a);
  check('2 an error in the log woke one hunt, which replayed it and filed a report', ra.reproduced === true && ra.fails.some((x) => x.path === FAIL) && n('select count(*) from wakes where id=?', a) === 1, { rule: ra.rule, fails: ra.fails.length, passes: ra.passes.length });

  const lines = fs.readFileSync(source.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.requestId === a);
  const dup = await wake({ id: a, lines: [lines.find((l) => l.event === 'request.failed'), lines.find((l) => l.event === 'http.request')] });
  const dupJson = await dup.json();
  check('3 the same event sent twice runs once', dup.status === 200 && dupJson.status === 'already hunted' && n('select count(*) from reports') === 1 && n('select count(*) from hunts') === 1, { answer: dupJson.status, hunts: 1, reports: 1 });

  // Watcher down while an error happens; then it starts with nothing new written.
  await kill(watcher);
  const b = await failOnce();
  await delay(600);
  check('4a control: with the watcher stopped, the error wakes nothing', n('select count(*) from wakes where id=?', b) === 0, {});
  bootWatcher(source);
  await until(() => n('select count(*) from wakes where id=?', b) === 1, 'restarted watcher sends the unread error', 15000);
  await delay(600);
  check('4b a restarted watcher sends the error it missed, once, and does not send the old one again', n('select count(*) from wakes where id=?', b) === 1 && n('select count(*) from wakes where id=?', a) === 2, { wakesForOld: 2, wakesForNew: 1 });

  // Kill the host in the middle of that hunt, after at least one saved step.
  const session = q('select session from hunts where id=?', b)[0].session;
  await until(() => n('select count(*) from calls where hunt=?', b) > 0, 'first request of the second hunt');
  if (reportOf(b)) throw Error('missed the crash window');
  const before = n('select count(*) from calls where hunt=?', b);
  await kill(host);
  await bootHost(repro);
  await until(() => reportOf(b), 'report after the restart');
  const rb = reportOf(b);
  check('5 the host was killed mid-hunt; after a restart the same session finished with one report', rb.reproduced === true && q('select session from hunts where id=?', b)[0].session === session && n('select count(*) from reports') === 2 && n('select count(*) from hunts') === 2, { session, requestsBeforeKill: before, requestsInAll: n('select count(*) from calls where hunt=?', b), rule: rb.rule });

  // Watcher dies after sending and before saving its place.
  await kill(watcher);
  bootWatcher(source, { WATCH_DIE_AFTER_SEND: '1' });
  const died = new Promise((r) => watcher.once('exit', r));
  const c = await failOnce();
  await died;
  check('6a the watcher sent the event and died before saving its place', n('select count(*) from wakes where id=? and http=202', c) === 1, {});
  bootWatcher(source);
  await until(() => n('select count(*) from wakes where id=?', c) === 2, 'second delivery after the watcher restart', 15000);
  await until(() => reportOf(c), 'report for the third error');
  check('6b it sent the event again after restarting; the host ran it once', n('select count(*) from wakes where id=? and http=200', c) === 1 && n('select count(*) from hunts where id=?', c) === 1 && n('select count(*) from hunts') === 3 && n('select count(*) from reports') === 3, { deliveries: 2, hunts: 1 });

  // Control for the saved place: throw it away and the watcher sends everything again (the host still runs nothing twice).
  await kill(watcher);
  const wakesBefore = n('select count(*) from wakes');
  fs.rmSync(path.join(out, 'watcher-state.json'));
  bootWatcher(source);
  await until(() => n('select count(*) from wakes') === wakesBefore + 3, 'the watcher with no saved place re-sends all three', 15000);
  await delay(600);
  check('7 control: without its saved place the watcher re-sends all three events; still three hunts, three reports', n('select count(*) from wakes') === wakesBefore + 3 && n('select count(*) from hunts') === 3 && n('select count(*) from reports') === 3, { resent: 3 });
} catch (e) { console.error(String(e)); checks.push({ name: 'run', ok: false, detail: String(e) }); process.exitCode = 1; }
finally {
  for (const child of [...kids]) await kill(child, 'SIGTERM').catch(() => {});
  const data = { checks, model: process.env.HUNT_MODEL || 'anthropic/claude-haiku-5-5', reports: db ? q('select id,json from reports').map((r) => ({ id: r.id, ...JSON.parse(r.json) })) : [], wakes: db ? q('select * from wakes') : [], spend: db ? q('select settled,count(*) requests,sum(cost) usd from budget group by settled') : [] };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(data, null, 2));
  db?.close();
}
