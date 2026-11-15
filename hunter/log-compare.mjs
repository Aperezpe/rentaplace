#!/usr/bin/env node
// Does logging the query matter to the hunter? The same hunts on two copies of the broken project: one as it is
// (the request log keeps the query) and one with that single field removed (the log keeps only the path).
// usage: node hunter/log-compare.mjs <outFolder> <brokenCopyFolder> [hunts=3]      env PORT0 (default 5741; uses three ports)
// A hunt "replayed exactly" when its report lists the logged request, path and query, among the failing ones.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
const here = import.meta.dirname;
const out = path.resolve(process.argv[2]), copy = path.resolve(process.argv[3]), hunts = Number(process.argv[4] || 3);
const P = Number(process.env.PORT0 || 5741), token = randomBytes(24).toString('hex'), hostUrl = `http://127.0.0.1:${P + 2}`;
const FAIL = '/api/quote?slug=lakeside-a-frame&from=2026-11-29&to=2026-12-02&guests=2';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const delay = (n) => new Promise((r) => setTimeout(r, n));
const until = async (fn, label, max = 300000) => { const t = Date.now(); while (Date.now() - t < max) { const x = await fn(); if (x) return x; await delay(150); } throw Error('timed out: ' + label); };
const kids = new Set();
const start = (name, args, env) => { const log = fs.openSync(path.join(out, name + '.log'), 'a'); const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { cwd: out, env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env }, stdio: ['ignore', log, log] }); kids.add(child); child.once('exit', () => kids.delete(child)); return child; };
async function app(name, port) {
  const dir = path.join(out, name); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(copy, 'data/rentaplace.db'), path.join(dir, 'app.db'));
  start(name, [path.join(here, 'serve.mjs'), copy], { RAP_DB: path.join(dir, 'app.db'), RAP_LOG_DIR: path.join(dir, 'logs'), RAP_OUTBOX_DIR: path.join(dir, 'outbox'), PORT: String(port), RAP_TODAY: '2026-11-09' });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, name + ' start', 15000);
  return { base, log: path.join(dir, 'logs/app.log') };
}
let db; const rows = [];
try {
  const source = await app('source', P), repro = await app('repro', P + 1);
  const host = start('host', [path.join(here, 'host.ts')], { HUNT_BASE: repro.base, HUNT_OUT: out, HUNT_ROLE: path.join(here, 'job.md'), HUNT_TOKEN: token, HUNT_PORT: String(P + 2), HUNT_CAP: '3', HUNT_MODEL: process.env.HUNT_MODEL || 'anthropic/claude-haiku-5-5' });
  await until(async () => { if (host.exitCode !== null) throw Error('host exited'); try { return (await fetch(hostUrl + '/x')).status === 404; } catch { return false; } }, 'host start', 30000);
  db = new DatabaseSync(path.join(out, 'host.db'), { readOnly: true });
  start('watcher', [path.join(here, 'watcher.mjs')], { HUNT_LOG: source.log, HUNT_STATE: path.join(out, 'watcher-state.json'), HUNT_HOST: hostUrl, HUNT_TOKEN: token });
  for (let i = 0; i < hunts; i++) {
    const r = await fetch(source.base + FAIL); if (r.status !== 500) throw Error('the planted bug did not fail: ' + r.status);
    const id = r.headers.get('x-request-id');
    const logged = fs.readFileSync(source.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.requestId === id && l.event === 'http.request') ?? (await delay(300), fs.readFileSync(source.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.requestId === id && l.event === 'http.request'));
    const rep = JSON.parse((await until(() => db.prepare('select json from reports where id=?').get(id), 'report ' + (i + 1))).json);
    const calls = db.prepare('select * from calls where hunt=? order by 1').all(id);
    const row = { hunt: id, logLineHasQuery: 'query' in logged, logLine: { method: logged.method, path: logged.path, query: logged.query ?? null, status: logged.status }, saidReproduced: rep.reproduced === true, replayedExactly: (rep.fails ?? []).some((x) => x.path === FAIL), madeTheExactRequest: calls.some((c) => Object.values(c).includes(FAIL)), requests: calls.length, got500: calls.filter((c) => Number(c.status) === 500).length, fails: (rep.fails ?? []).length, passes: (rep.passes ?? []).length, rule: rep.rule, notes: rep.notes };
    rows.push(row); console.log(JSON.stringify(row));
  }
} catch (e) { console.error(String(e)); rows.push({ error: String(e) }); process.exitCode = 1; }
finally {
  for (const child of [...kids]) { child.kill('SIGTERM'); }
  const spend = db ? db.prepare('select count(*) requests, sum(cost) usd from budget').get() : null;
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ copy, model: process.env.HUNT_MODEL || 'anthropic/claude-haiku-5-5', hunts: rows, spend }, null, 2));
  db?.close();
}
