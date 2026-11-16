import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore plain JavaScript module
import { decide as decideRule, readAnswers, questions, MONEY_AT, MONEY_SURE, OWNER_SURE } from '../sorter/jev.mjs';
// @ts-ignore plain JavaScript module
import { pass, readTags } from '../sorter/core.mjs';

const decide = decideRule as (got: unknown) => any;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-jev-')), 'tags.jsonl');
const line = (id: string) => JSON.stringify({ event: 'support.received', ticketId: id }) + '\n';
const answers = (owner: string, confidence: number, noul: number) => ({ owner: { type: 'choice', choice: owner, confidence, probabilities: { booking: 0.1, pricing: 0.8, nobody: 0.1 } }, money: { type: 'noul', noul } });
const got = (ownerConfidence: number, moneyP: number) => ({ owner: 'pricing', ownerConfidence, ownerP: {}, moneyP });

test('the bars are the ones chosen from the first trial', () => {
  assert.deepEqual([MONEY_AT, MONEY_SURE, OWNER_SURE], [0.3, 0.7, 0.7]);
});

test('sure answers are not marked unsure: clear money, clear not money', () => {
  assert.deepEqual(decide(got(0.95, 0.91)), { owner: 'pricing', money: true, unsure: false, why: [], moneyP: 0.91, ownerConfidence: 0.95 });
  const no = decide(got(0.95, 0.04));
  assert.deepEqual([no.money, no.unsure], [false, false]);
});

test('money probability in the unsure band: counted as money AND marked unsure, with the reason', () => {
  for (const p of [0.3, 0.42, 0.53, 0.699]) { const d = decide(got(0.95, p)); assert.deepEqual([d.money, d.unsure, d.why.length], [true, true, 1], String(p)); assert.match(d.why[0], /money probability/); }
  // The edges: just under the lower bar is plain not-money; at the upper bar is plain money.
  assert.deepEqual([decide(got(0.95, 0.299)).money, decide(got(0.95, 0.299)).unsure], [false, false]);
  assert.deepEqual([decide(got(0.95, 0.7)).money, decide(got(0.95, 0.7)).unsure], [true, false]);
});

test('owner confidence under the bar: unsure even when the money answer is clear', () => {
  const d = decide(got(0.69, 0.02));
  assert.deepEqual([d.money, d.unsure], [false, true]);
  assert.match(d.why[0], /owner confidence 0\.69 is under 0\.70/);
  assert.equal(decide(got(0.7, 0.02)).unsure, false);
  assert.equal(decide(got(0.4, 0.5)).why.length, 2);
});

test('answers are used only when complete and well formed; nothing is defaulted', () => {
  assert.deepEqual(readAnswers(answers('pricing', 0.9, 0.8)), { owner: 'pricing', ownerConfidence: 0.9, ownerP: { booking: 0.1, pricing: 0.8, nobody: 0.1 }, moneyP: 0.8 });
  const ok = answers('pricing', 0.9, 0.8);
  const bad = [null, {}, { owner: ok.owner }, { money: ok.money }, { ...ok, extra: ok.money }, answers('payments', 0.9, 0.8), answers('pricing', 1.2, 0.8), answers('pricing', 0.9, NaN), answers('pricing', 0.9, -0.1),
    { ...ok, money: { type: 'score', noul: 0.8 } }, { ...ok, owner: { ...ok.owner, probabilities: { booking: 0.5, pricing: 0.5 } } }, { ...ok, owner: { ...ok.owner, probabilities: { booking: 0.2, pricing: 0.2, nobody: 0.2, other: 0.4 } } }, { ...ok, owner: { ...ok.owner, confidence: '0.9' } }];
  for (const b of bad) assert.equal(readAnswers(b), null, JSON.stringify(b));
  assert.equal(decide(null), null);
  assert.deepEqual(Object.keys(questions(['nobody', 'booking', 'pricing']).owner.criteria), ['nobody', 'booking', 'pricing']);
});

test('in a pass: an unsure ticket waits for a person and the row says why; a malformed answer writes no tag', async () => {
  const file = tmp();
  const inbox = [{ id: 'a', subject: 's', message: 'm' }, { id: 'b', subject: 's', message: 'm' }, { id: 'c', subject: 's', message: 'm' }, { id: 'd', subject: 's', message: 'm' }];
  const by: Record<string, unknown> = { a: answers('booking', 0.5, 0.47), b: answers('nobody', 0.95, 0.03), c: { owner: answers('pricing', 0.9, 0.9).owner }, d: answers('pricing', 0.97, 0.92) };
  const r = await pass({ offset: 0, bytes: Buffer.from(['a', 'b', 'c', 'd'].map(line).join('')), tagsFile: file, fetchTickets: async () => inbox, sort: async (t: { id: string }) => ({ got: readAnswers(by[t.id]) }), read: (a: { got: unknown }) => decide(a.got), model: 'jev-test', now: () => 't' });
  assert.deepEqual(r.unsorted.map((u: any) => u.ticketId), ['c']);
  const rows = Object.fromEntries(readTags(file).map((x: any) => [x.ticketId, x]));
  assert.deepEqual(Object.keys(rows), ['a', 'b', 'd']);
  assert.deepEqual([rows.a.money, rows.a.unsure, rows.a.waitsFor, rows.a.why.length, rows.a.moneyP, rows.a.ownerConfidence], [true, true, 'a person', 2, 0.47, 0.5]);
  assert.deepEqual([rows.b.money, rows.b.unsure, rows.b.waitsFor], [false, undefined, undefined]);
  assert.deepEqual([rows.d.money, rows.d.unsure, rows.d.waitsFor], [true, undefined, 'a person']);
});

test('the model cannot be reached: "offline", the saved place does not move, earlier tags stay, and the next pass finishes the rest once', async () => {
  const file = tmp();
  const inbox = [{ id: 'a', subject: 's', message: 'm' }, { id: 'b', subject: 's', message: 'm' }];
  const bytes = Buffer.from(line('a') + line('b'));
  let down = true;
  const sort = async (t: { id: string }) => { if (t.id === 'b' && down) throw Error('timeout'); return '{"owner":"booking","money":false}'; };
  const r1 = await pass({ offset: 0, bytes, tagsFile: file, fetchTickets: async () => inbox, sort, model: 'm' });
  assert.deepEqual([r1.status, r1.offset, r1.unsorted, readTags(file).map((x: any) => x.ticketId)], ['offline', 0, [], ['a']]);
  down = false;
  const r2 = await pass({ offset: r1.offset, bytes, tagsFile: file, fetchTickets: async () => inbox, sort, model: 'm' });
  assert.deepEqual([r2.status, r2.already, r2.tagged.map((x: any) => x.ticketId), r2.offset, readTags(file).length], ['ok', 1, ['b'], bytes.length, 2]);
});
