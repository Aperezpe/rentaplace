import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.ts';
import { issueRows } from '../src/issues.ts';

const tag = (ticketId: string, owner: string, money: boolean, unsure: boolean, why: string[]) => ({ ticketId, owner, money, unsure, why, moneyP: 0.5, ownerConfidence: 0.5, model: 'jev-1.14.0', at: 'x' });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rap-issues-'));
  const dbPath = join(dir, 'app.db');
  const db = openDatabase(dbPath);
  const add = (id: string, subject: string, at: string) => db.prepare('INSERT INTO support_tickets VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, null, 'Mira Valewood', 'mira@example.test', subject, 'Private message text', 'uncategorized', null, 'open', at);
  add('sorted-booking', 'Arrive late', '2026-11-09T12:00:06Z');
  add('untagged', 'Never sorted', '2026-11-09T12:00:05Z');
  add('tagged-nobody', 'Wifi', '2026-11-09T12:00:04Z');
  add('money', 'Charged twice', '2026-11-09T12:00:03Z');
  add('unsure', 'Mixed question', '2026-11-09T12:00:02Z');
  db.close();
  writeFileSync(join(dir, 'support-tags.jsonl'), [
    tag('sorted-booking', 'booking', false, false, ['no money: moneyP 0.05 < 0.3', 'owner booking at confidence 1']),
    tag('tagged-nobody', 'nobody', false, false, ['no money: moneyP 0.03 < 0.3', 'owner nobody at confidence 0.85']),
    tag('money', 'pricing', true, false, ['money: moneyP 0.91 >= 0.3', 'owner pricing at confidence 0.96']),
    tag('unsure', 'booking', false, true, ['no money: moneyP 0.1 < 0.3', 'owner booking at confidence 0.28', 'unsure: owner confidence 0.28 < 0.7']),
  ].map(t => JSON.stringify(t)).join('\n') + '\n');
  return { dir, dbPath };
}

test('waiting tickets (money or unsure) come first, with every reason from why', () => {
  const { dir, dbPath } = fixture();
  const rows = issueRows(dbPath, dir);
  assert.deepEqual(rows.slice(0, 2).map(r => r.id).sort(), ['money', 'unsure']);
  assert.ok(rows.slice(2).every(r => r.state !== 'waiting'));
  const unsure = rows.find(r => r.id === 'unsure')!;
  for (const why of ['no money: moneyP 0.1 < 0.3', 'owner booking at confidence 0.28', 'unsure: owner confidence 0.28 < 0.7']) assert.ok(unsure.detail.includes(why), why);
  assert.ok(rows.find(r => r.id === 'money')!.detail.includes('money: moneyP 0.91 >= 0.3'));
});

test('every ticket has exactly one label; untagged is "not sorted", never nobody', () => {
  const { dir, dbPath } = fixture();
  const rows = issueRows(dbPath, dir);
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(['booking', 'pricing', 'nobody', 'not sorted'].filter(l => r.title.startsWith(`${l} ·`)).length, 1, r.title);
  const untagged = rows.find(r => r.id === 'untagged')!;
  assert.equal(untagged.state, 'not sorted'); assert.equal(untagged.owner, null);
  assert.ok(untagged.title.startsWith('not sorted ·') && !/nobody/.test(untagged.title + untagged.detail));
  const nobody = rows.find(r => r.id === 'tagged-nobody')!;
  assert.equal(nobody.owner, 'nobody'); assert.ok(nobody.title.startsWith('nobody ·'));
});

test('no message, name or email on any row', () => {
  const { dir, dbPath } = fixture();
  assert.ok(!/Private message|Mira|mira@/.test(JSON.stringify(issueRows(dbPath, dir))));
});

test('read only: tickets and tags are unchanged', () => {
  const { dir, dbPath } = fixture();
  const hash = () => {
    const db = openDatabase(dbPath);
    const rows = JSON.stringify(db.prepare('SELECT * FROM support_tickets ORDER BY id').all());
    db.close();
    return createHash('sha256').update(rows).update(readFileSync(join(dir, 'support-tags.jsonl'))).digest('hex');
  };
  const before = hash();
  issueRows(dbPath, dir); issueRows(dbPath, dir);
  assert.equal(hash(), before);
});
