import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport, failureOf, type Result } from '../src/hunter.ts';
import { ASK_MAIN, huntCard, huntCards } from '../src/hunts.ts';

const line = { event: 'http.request', method: 'GET', path: '/api/quote', status: 500, requestId: 'r1', query: { slug: 'lakeside-a-frame', from: '2026-11-20', to: '2026-11-23', guests: '2' } };
const r = (n: number, outcome: Result['outcome'], status: number, slug = 'lakeside-a-frame'): Result =>
  ({ n, label: `try ${n}`, method: 'GET', path: '/api/quote', query: { slug, from: '2026-11-20' }, body: null, as: null, filled: [], status, errorCode: status === 500 ? 'INTERNAL_ERROR' : null, outcome, ms: 1 });
const summary = { kept: [], dropped: [], invalid: false };

test('a card: short name, request count, replay line, and the three rows with counts and request numbers', () => {
  const md = renderReport(failureOf(line)!, [r(1, 'failed', 500), r(2, 'failed', 500), r(3, 'worked', 200, 'fern-cottage'), r(4, 'neither', 409)], summary);
  const card = huntCard('r1', md);
  assert.equal(card.title, 'GET /api/quote lakeside-a-frame · 4 requests · replay: same failure');
  assert.equal(card.detail, 'Fails 2: #1, #2\nStill works 1: #3\nNeither 1: #4');
  assert.equal(card.report, md);
});

test('a replay that does not fail the same way says so', () => {
  const card = huntCard('r1', renderReport(failureOf(line)!, [r(1, 'worked', 200), r(2, 'failed', 500)], summary));
  assert.match(card.title, /replay: not the same failure \(200, worked\)$/);
  assert.equal(card.detail, 'Fails 1: #2\nStill works 1: #1\nNeither 0');
});

test('an event with nothing to replay, and newest reports first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rap-hunts-'));
  mkdirSync(join(dir, 'reports'));
  writeFileSync(join(dir, 'reports', 'old.md'), renderReport(failureOf(line)!, [r(1, 'failed', 500)], summary));
  writeFileSync(join(dir, 'reports', 'outbox-b1.md'), renderReport(failureOf({ event: 'outbox.failed', bookingId: 'b1' })!, [], summary));
  const t = new Date(Date.now() - 60_000); utimesSync(join(dir, 'reports', 'old.md'), t, t);
  const cards = huntCards(dir);
  assert.deepEqual(cards.map(c => c.id), ['outbox-b1', 'old']);
  assert.equal(cards[0].title, 'outbox.failed · 0 requests · nothing to replay');
});

test('Enter sends the whole report to Main, ending with the instruction', () => {
  const cfg = JSON.parse(readFileSync('widgets/hunts/widget.json', 'utf8'));
  const enter = cfg.actions[0];
  assert.equal(enter.type, 'send');
  assert.ok(enter.template.startsWith('{{report}}') && enter.template.endsWith(ASK_MAIN));
  assert.equal(cfg.judge, false);
});
