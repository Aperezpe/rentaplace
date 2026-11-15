import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore plain JavaScript module
import { parseReply, keywordSort, grade, readArrivals, addTag, readTags, pass } from '../sorter/core.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-')), 'tags.jsonl');
const line = (id: string) => JSON.stringify({ event: 'support.received', ticketId: id }) + '\n';
const inbox = [{ id: 'a', subject: 'Refund timing', message: 'When will the refund show up?' }, { id: 'b', subject: 'Pets', message: 'Two dogs?' }];
const model = (reply: string) => async () => reply;

test('a reply is a tag only in the asked shape; anything else is no tag', () => {
  assert.deepEqual(parseReply('{"owner":"pricing","money":true}'), { owner: 'pricing', money: true });
  assert.deepEqual(parseReply('Sure! {"owner":"nobody","money":false} hope that helps'), { owner: 'nobody', money: false });
  for (const bad of ['', 'pricing, yes', '{"owner":"payments","money":true}', '{"owner":"pricing","money":"yes"}', '{"owner":"pricing"}']) assert.equal(parseReply(bad), null);
});

test('keyword rules: catch the word "refund", miss money said without a money word', () => {
  assert.deepEqual(keywordSort(inbox[0]), { owner: 'pricing', money: true });
  assert.equal(keywordSort({ subject: 'Still waiting', message: 'Nothing has come back to my card yet.' }).money, false);
});

test('grading accepts either owner on a border ticket, never a wrong money flag', () => {
  const t = { owner: ['booking', 'nobody'], money: false };
  assert.deepEqual(grade(t, { owner: 'nobody', money: false }), { owner: true, money: true, valid: true });
  assert.equal(grade(t, { owner: 'nobody', money: true }).money, false);
  assert.deepEqual(grade(t, null), { owner: false, money: false, valid: false });
});

test('arrivals: only whole support.received lines, and the place moves past them', () => {
  const bytes = Buffer.from(line('a') + JSON.stringify({ event: 'http.request', requestId: 'x' }) + '\n' + line('b').slice(0, 20));
  const r = readArrivals(100, bytes);
  assert.deepEqual(r.ids, ['a']);
  assert.equal(r.next, 100 + bytes.lastIndexOf(0x0a) + 1);
});

test('the tags file is add-only and one line per ticket: the same ticket twice is tagged once', async () => {
  const file = tmp();
  const first = await pass({ offset: 0, bytes: Buffer.from(line('a') + line('a')), tagsFile: file, fetchTickets: async () => inbox, sort: model('{"owner":"pricing","money":true}'), model: 'm', now: () => 't1' });
  assert.equal(first.tagged.length, 1);
  const before = fs.readFileSync(file, 'utf8');
  // The same arrival read again from byte 0 (a lost saved place), with a model that now says something else.
  const again = await pass({ offset: 0, bytes: Buffer.from(line('a') + line('b')), tagsFile: file, fetchTickets: async () => inbox, sort: model('{"owner":"nobody","money":false}'), model: 'm', now: () => 't2' });
  assert.deepEqual([again.already, again.tagged.map((r: any) => r.ticketId)], [1, ['b']]);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith(before), 'earlier lines are never rewritten');
  assert.deepEqual(readTags(file).map((r: any) => [r.ticketId, r.owner, r.money, r.waitsFor]), [['a', 'pricing', true, 'a person'], ['b', 'nobody', false, undefined]]);
  assert.equal(addTag(file, { ticketId: 'a', owner: 'booking', money: false }), false);
});

test('support API down: "offline", no tag, and the saved place does not move', async () => {
  const file = tmp();
  let asked = 0;
  const r = await pass({ offset: 7, bytes: Buffer.from(line('a')), tagsFile: file, fetchTickets: async () => { throw Error('connect ECONNREFUSED'); }, sort: async () => { asked++; return '{"owner":"pricing","money":true}'; }, model: 'm' });
  assert.deepEqual([r.status, r.tagged, r.offset, asked, fs.existsSync(file)], ['offline', [], 7, 0, false]);
});

test('a reply in the wrong shape leaves the ticket unsorted: no guessed tag', async () => {
  const file = tmp();
  const r = await pass({ offset: 0, bytes: Buffer.from(line('a') + line('zz')), tagsFile: file, fetchTickets: async () => inbox, sort: model('I think this is about refunds.'), model: 'm' });
  assert.deepEqual([r.tagged, r.unsorted.map((u: any) => u.ticketId), r.missing, fs.existsSync(file)], [[], ['a'], ['zz'], false]);
});
