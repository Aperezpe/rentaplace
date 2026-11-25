import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers.ts';
import { Hunter, checkClaims, classify, failureOf, planFor, reportPath, type Ask } from '../src/hunter.ts';
import { Watcher } from '../src/watcher.ts';

const line = { time: 't', event: 'http.request', method: 'GET', path: '/api/quote', status: 500, ms: 1, requestId: 'req-broken-home',
  query: { slug: 'lakeside-a-frame', from: '2026-11-20', to: '2026-11-23', guests: '2' } };

/** A scratch "real" app database with a planted bug: one home's photos are not valid JSON, so quoting it is a 500. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'rap-hunter-'));
  const sourceDb = join(dir, 'real.db');
  const { db } = fixture(sourceDb);
  db.prepare("UPDATE listings SET photos='not json' WHERE slug='lakeside-a-frame'").run();
  db.close();
  const hash = () => createHash('sha256').update(readFileSync(sourceDb)).digest('hex');
  return { dir, sourceDb, hash, huntsDir: join(dir, 'hunts') };
}
const ask: Ask = async () => JSON.stringify({ claims: [
  { text: 'Quoting lakeside-a-frame fails on every date tried.', requests: [1, 2, 7] },
  { text: 'Other homes quote fine.', requests: [8, 9] },
  { text: 'Made up.', requests: [99] },
  { text: 'No citation.', requests: [] },
] });

test('replays on a copy, varies dates, homes and guests, and reports where it fails and where it works', async () => {
  const w = world(), before = w.hash();
  const hunter = await new Hunter({ dir: w.huntsDir, sourceDb: w.sourceDb, ask }).open();
  try {
    const f = failureOf(line)!;
    assert.equal(await hunter.start(f), 'started');
    assert.equal(await hunter.start(f), 'skipped', 'one hunt per failure ID');
    await hunter.waitFor(f.id);
    const report = readFileSync(reportPath(f.id, w.huntsDir), 'utf8');
    const rows = report.split('\n').filter(l => /^\| \d+ \|/.test(l));
    assert.deepEqual(rows.map(r => Number(r.split('|')[1])), rows.map((_, i) => i + 1), 'numbered 1..n, each once');
    assert.match(rows[0], /replay as logged .* \| 500 INTERNAL_ERROR \| failed \|$/);
    assert.ok(rows.filter(r => /dates shifted/.test(r)).every(r => r.endsWith('| failed |')));
    assert.ok(rows.filter(r => /other home/.test(r)).every(r => r.endsWith('| worked |')));
    const n = (o: string) => rows.filter(r => r.endsWith(`| ${o} |`)).length;
    assert.ok(report.includes(`| failed | ${n('failed')} |`) && report.includes(`| worked | ${n('worked')} |`) && report.includes(`| total | ${rows.length} |`));
    assert.ok(report.includes('Quoting lakeside-a-frame fails on every date tried. (#1, #2, #7)'));
    assert.ok(!report.includes('Made up') && !report.includes('No citation.'));
    assert.ok(report.includes('2 claim(s) dropped'));
    assert.ok(report.includes('## Values filled in') && report.includes('None. Every value came from the log'));
    assert.equal(w.hash(), before, 'the real database is untouched');
    assert.equal(await hunter.start(f), 'skipped', 'a report exists');
  } finally { await hunter.close(); }
});

test('a restart in the middle continues the same hunt and ends with one report', async () => {
  const w = world();
  let seen = 0, reached!: () => void;
  const third = new Promise<void>(r => { reached = r; });
  const first = await new Hunter({ dir: w.huntsDir, sourceDb: w.sourceDb, ask, onRecord: () => { if (++seen === 3) reached(); } }).open();
  const f = failureOf({ ...line, requestId: 'req-restart' })!;
  await first.start(f);
  await third;
  await first.close();
  assert.ok(!existsSync(reportPath(f.id, w.huntsDir)), 'not finished before the stop');
  const sent: number[] = [];
  const second = await new Hunter({ dir: w.huntsDir, sourceDb: w.sourceDb, ask, onRecord: (_id, r) => sent.push(r.n) }).open();
  try {
    assert.equal(await second.start(f), 'skipped', 'the same hunt, not a new one');
    await second.waitFor(f.id);
    assert.ok(!sent.includes(1) && !sent.includes(2), `requests recorded before the stop are not sent again (sent ${sent})`);
    const rows = readFileSync(reportPath(f.id, w.huntsDir), 'utf8').split('\n').filter(l => /^\| \d+ \|/.test(l));
    assert.deepEqual(rows.map(r => Number(r.split('|')[1])), rows.map((_, i) => i + 1));
  } finally { await second.close(); }
});

test('filled-in values are named in the report, the card only by its last four digits', async () => {
  const w = world();
  const hunter = await new Hunter({ dir: w.huntsDir, sourceDb: w.sourceDb, ask: async () => '{"claims":[]}' }).open();
  try {
    const f = failureOf({ ...line, requestId: 'req-checkout', method: 'POST', path: '/api/bookings', query: undefined, body: { slug: 'lakeside-a-frame', from: '2026-11-20', to: '2026-11-23', guests: 2 } })!;
    await hunter.start(f);
    await hunter.waitFor(f.id);
    const report = readFileSync(reportPath(f.id, w.huntsDir), 'utf8');
    for (const v of ['cardNumber: demo test card ending 4242', 'guestName: Test Guest', 'guestEmail: test-guest@example.test', 'signed in as guest-1']) assert.ok(report.includes(`- ${v}`), v);
    assert.ok(!report.includes('4242 4242'), 'never the full card number');
  } finally { await hunter.close(); }
});

test('rules: which lines start a hunt, the plan, outcomes and claims', () => {
  assert.equal(failureOf({ event: 'http.request', status: 404, requestId: 'x' }), null);
  assert.equal(failureOf({ event: 'request.failed', requestId: 'x' }), null);
  assert.equal(failureOf({ event: 'outbox.failed', bookingId: 'b1' })!.id, 'outbox-b1');
  const plan = planFor(failureOf(line)!.request!, [{ slug: 'lakeside-a-frame', region: 'A' }, { slug: 'x', region: 'A' }, { slug: 'y', region: 'B' }]);
  assert.deepEqual(plan.map(p => p.n), plan.map((_, i) => i + 1));
  assert.deepEqual(plan[1].query, { slug: 'lakeside-a-frame', from: '2026-11-13', to: '2026-11-16', guests: '2' });
  assert.equal(plan.find(p => p.label.startsWith('other home'))!.query.slug, 'x');
  const orig = { method: 'GET', path: '/', status: 500 };
  assert.deepEqual([classify(orig, 500, 'INTERNAL_ERROR'), classify(orig, 200, null), classify(orig, 409, 'X'), classify(orig, 0, null)], ['failed', 'worked', 'neither', 'neither']);
  assert.equal(checkClaims('not json', []).invalid, true);
});

test('the watcher starts one hunt per failure line and keeps sorting tickets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-hunter-watch-'));
  const log = join(dir, 'app.log');
  writeFileSync(log, '');
  const started: string[] = [];
  const seen = new Set<string>();
  const hunter = { start: async (f: any) => { started.push(f.id); if (seen.has(f.id)) return 'skipped' as const; seen.add(f.id); return 'started' as const; } };
  const w = new Watcher({ logPath: log, dir, say: () => {}, hunter, sorter: async () => {} });
  await w.tick();
  for (const l of [line, { event: 'request.failed', requestId: 'req-broken-home' }, line, { event: 'outbox.failed', bookingId: 'b1' }, { event: 'support.received', ticketId: 'T1' }]) appendFileSync(log, JSON.stringify(l) + '\n');
  await w.tick();
  assert.deepEqual(started, ['req-broken-home', 'req-broken-home', 'outbox-b1']);
  assert.deepEqual(w.state.done, ['T1']);
});
