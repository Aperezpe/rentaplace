import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import { openDatabase } from '../src/db.ts';
import { LOG_DIR } from '../src/config.ts';
import { Watcher } from '../src/watcher.ts';
import { decide } from '../src/jev.ts';

const LOG = join(LOG_DIR, 'app.log');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean, ms = 8000) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await sleep(50); } }
const tags = (dir: string) => existsSync(join(dir, 'support-tags.jsonl')) ? readFileSync(join(dir, 'support-tags.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const bookmark = (dir: string) => JSON.parse(readFileSync(join(dir, 'bookmark.json'), 'utf8'));

/** Stands in for TypeSafe so the test can take Jev down or make it answer nonsense. */
async function fakeJev() {
  const state = { mode: 'up' as 'up' | 'down' | 'invalid', calls: 0, auth: '' };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
      state.calls++; state.auth = String(req.headers.authorization);
      if (state.mode === 'down') { res.writeHead(503); return res.end('{"detail":"down"}'); }
      if (state.mode === 'invalid') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"model":"jev-1.14.0","answers":{"owner":{"type":"choice","choice":"marketing","confidence":0.9}},"usage":{"input_tokens":1,"output_tokens":1}}'); }
      const q = JSON.parse(body);
      assert.deepEqual(Object.keys(q.questions), ['owner', 'money']);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-1.14.0', answers: { owner: { type: 'choice', choice: 'pricing', confidence: 0.52, probabilities: { booking: 0.31, pricing: 0.68, nobody: 0.01 } }, money: { type: 'noul', noul: 0.85 } }, usage: { input_tokens: 455, output_tokens: 56 } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { state, url: `http://127.0.0.1:${(server.address() as any).port}/v1/systemone`, close: () => server.close() };
}

/** The app on a real database file, so the watcher process can read the ticket. */
async function app(dir: string) {
  const dbPath = join(dir, 'app.db');
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO flags VALUES (?,?,?)').run('support_form', 1, 'support_form');
  const { server } = createApp(db);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (subject: string) => {
    const res = await fetch(`${base}/api/support`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mira Valewood', email: 'mira@example.test', subject, message: 'The door code is not working.' }) });
    return { status: res.status, id: ((await res.json()) as any).ticket?.id as string };
  };
  const row = (id: string) => db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id);
  return { dbPath, post, row, close: () => { server.close(); db.close(); } };
}

/** The watcher as its own process, exactly as `npm run watcher` starts it. */
async function startWatcher(dir: string, dbPath: string, jevUrl: string) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/watcher.ts'], { env: { ...process.env, RAP_WATCHER_DIR: dir, RAP_DB: dbPath, TYPESAFE_ENDPOINT: jevUrl, TYPESAFE_API_KEY: 'test-key', RAP_WATCHER_RETRY_MS: '200', RAP_HUNTS_DIR: join(dir, 'hunts') }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout!.on('data', d => { out += d; });
  await until(() => out.includes('watcher.started'));
  return { child, out: () => out };
}
const stopWatcher = (child: ChildProcess) => new Promise(r => { if (child.exitCode !== null) return r(null); child.on('exit', r); child.kill('SIGTERM'); });

test('a ticket posted through the app is tagged by Jev through the running watcher, once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-watcher-'));
  const jev = await fakeJev(), a = await app(dir);
  let w = await startWatcher(dir, a.dbPath, jev.url);
  try {
    const t = await a.post('Door code');
    assert.equal(t.status, 201);
    const before = JSON.stringify(a.row(t.id));
    const line = readFileSync(LOG, 'utf8').split('\n').find(l => l.includes(t.id))!;
    assert.deepEqual(Object.keys(JSON.parse(line)), ['time', 'event', 'ticketId']);

    await until(() => bookmark(dir).done.includes(t.id));
    const [tag] = tags(dir);
    assert.deepEqual(Object.keys(tag), ['ticketId', 'owner', 'money', 'unsure', 'why', 'moneyP', 'ownerConfidence', 'model', 'at']);
    assert.equal(tag.ticketId, t.id); assert.equal(tag.owner, 'pricing'); assert.equal(tag.money, true); assert.equal(tag.unsure, true);
    assert.equal(tag.moneyP, 0.85); assert.equal(tag.ownerConfidence, 0.52); assert.equal(tag.model, 'jev-1.14.0');
    assert.ok(tag.why.some((r: string) => r.includes('owner confidence 0.52 < 0.7')));
    assert.ok(!/mira|door|Valewood/i.test(JSON.stringify(tag)), 'no private details in the tag');
    assert.equal(jev.state.auth, 'Bearer test-key');
    assert.equal(JSON.stringify(a.row(t.id)), before, 'the ticket is unchanged');

    appendFileSync(LOG, line + '\n');
    await until(() => w.out().includes('watcher.duplicate'));
    assert.equal(jev.state.calls, 1, 'the same line twice calls Jev once');
    assert.equal(tags(dir).length, 1, 'and writes one tag');

    await stopWatcher(w.child);
    const stopped = await a.post('While the watcher is down');
    assert.equal(stopped.status, 201, 'guests get their reply with the watcher stopped');
    w = await startWatcher(dir, a.dbPath, jev.url);
    await until(() => bookmark(dir).done.includes(stopped.id));
    assert.deepEqual(tags(dir).map(x => x.ticketId), [t.id, stopped.id]);
    assert.equal(jev.state.calls, 2, 'a restart does not rerun the first ticket');
  } finally { await stopWatcher(w.child); a.close(); jev.close(); }
});

test('Jev offline or invalid: no tag, bookmark stays, logged offline, retried later', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-watcher-'));
  const jev = await fakeJev(), a = await app(dir);
  const w = await startWatcher(dir, a.dbPath, jev.url);
  try {
    jev.state.mode = 'down';
    const offsetBefore = bookmark(dir).offset;
    const t = await a.post('Jev is down');
    assert.equal(t.status, 201, 'the guest still gets the reply');
    await until(() => (w.out().match(/sorter\.offline/g) || []).length >= 2);
    assert.match(w.out(), /"event":"sorter.offline","ticketId":"[^"]+","reason":"Jev unreachable: 503/);
    assert.equal(tags(dir).length, 0, 'no tag');
    assert.equal(bookmark(dir).offset, offsetBefore, 'bookmark did not move');
    assert.ok(!bookmark(dir).done.includes(t.id));

    jev.state.mode = 'invalid';
    await until(() => w.out().includes('Jev answer invalid'));
    assert.equal(tags(dir).length, 0, 'an invalid answer writes no tag');
    assert.equal(bookmark(dir).offset, offsetBefore);

    jev.state.mode = 'up';
    await until(() => bookmark(dir).done.includes(t.id));
    assert.deepEqual(tags(dir).map(x => x.ticketId), [t.id]);
    assert.ok(w.out().includes('sorter.online'));
    assert.ok(bookmark(dir).offset > offsetBefore);
  } finally { await stopWatcher(w.child); a.close(); jev.close(); }
});

test('a tag saved before a crash, with the bookmark not yet moved, is not sent to Jev again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-watcher-'));
  const jev = await fakeJev(), a = await app(dir);
  const w = await startWatcher(dir, a.dbPath, jev.url);
  await stopWatcher(w.child);
  const t = await a.post('Crash between tag and bookmark');
  writeFileSync(join(dir, 'support-tags.jsonl'), JSON.stringify({ ticketId: t.id, owner: 'nobody', money: false, unsure: false, why: [], moneyP: 0.1, ownerConfidence: 0.9, model: 'jev-1.14.0', at: 'earlier' }) + '\n');
  const again = await startWatcher(dir, a.dbPath, jev.url);
  try {
    await until(() => bookmark(dir).done.includes(t.id));
    assert.ok(again.out().includes('tag already saved'));
    assert.equal(jev.state.calls, 0);
    assert.equal(tags(dir).length, 1);
  } finally { await stopWatcher(again.child); a.close(); jev.close(); }
});

test('the bookmark moves only after the tag is saved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-watcher-'));
  const log = join(dir, 'app.log');
  appendFileSync(log, '');
  let release!: () => void;
  const ran: string[] = [];
  const w = new Watcher({ logPath: log, dir, say: () => {}, sorter: id => { ran.push(id); return new Promise<void>(r => { release = r; }); } });
  await w.tick();
  appendFileSync(log, JSON.stringify({ time: 't', event: 'support.received', ticketId: 'T1' }) + '\n');
  const pending = w.tick();
  await until(() => ran.length === 1);
  assert.deepEqual(bookmark(dir), { ino: bookmark(dir).ino, offset: 0, lastTicketId: null, done: [] });
  release();
  await pending;
  const after = bookmark(dir);
  assert.equal(after.lastTicketId, 'T1');
  assert.deepEqual(after.done, ['T1']);
  assert.ok(after.offset > 0);
});

test('decide: thresholds and reasons', () => {
  const d = (p: number, c: number) => decide({ choice: 'pricing', confidence: c }, p);
  assert.deepEqual([d(0.29, 0.9).money, d(0.29, 0.9).unsure], [false, false]);
  assert.deepEqual([d(0.30, 0.9).money, d(0.30, 0.9).unsure], [true, true]);
  assert.deepEqual([d(0.69, 0.9).unsure, d(0.70, 0.9).unsure], [true, false]);
  assert.deepEqual([d(0.90, 0.69).unsure, d(0.90, 0.70).unsure], [true, false]);
  assert.ok(d(0.5, 0.5).why.length === 4);
});
