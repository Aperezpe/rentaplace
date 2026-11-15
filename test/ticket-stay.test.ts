import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JavaScript module
import { stayFromText, unreadFacts, slugCandidates } from '../drafts/ticket.mjs';
// @ts-ignore plain JavaScript module
import { checkDraft } from '../drafts/core.mjs';

const HOMES = new Set(['lakeside-a-frame', 'pine-hollow-cabin']);
const isListing = async (s: string) => HOMES.has(s);

test('a stay written unmistakably is read: one home, two full dates, a guest count', async () => {
  const r = await stayFromText('How much would Lakeside A-Frame be from 2026-11-16 to 2026-11-19 for 2 guests?', isListing);
  assert.deepEqual(r, { ok: true, stay: { slug: 'lakeside-a-frame', from: '2026-11-16', to: '2026-11-19', guests: 2 } });
  assert.equal((await stayFromText('lakeside-a-frame 2026-11-16 2026-11-19, two of us', isListing)).ok, true);
});

test('dates without a year are not read: code does not pick a year', async () => {
  const r = await stayFromText('How much would Lakeside A-Frame be for Nov 16 to 19, two of us?', isListing);
  assert.equal(r.ok, false);
  assert.deepEqual(r.found, { slug: 'lakeside-a-frame', guests: 2 });
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0], /dates/);
});

test('no home, two homes, one date, dates the wrong way round, no guest count: each is named as missing', async () => {
  const missing = async (t: string) => (await stayFromText(t, isListing)).missing?.join('|') ?? 'READ';
  assert.match(await missing('How much is the cabin from 2026-11-16 to 2026-11-19 for 2 guests?'), /^which home$/);
  assert.match(await missing('Lakeside A-Frame or Pine Hollow Cabin, 2026-11-16 to 2026-11-19, 2 guests'), /more than one/);
  assert.match(await missing('Lakeside A-Frame from 2026-11-16 for 2 guests'), /dates/);
  assert.match(await missing('Lakeside A-Frame 2026-11-19 to 2026-11-16 for 2 guests'), /dates/);
  assert.match(await missing('Lakeside A-Frame 2026-11-16 to 2026-11-19'), /how many guests/);
  assert.ok(slugCandidates('Is Lakeside A-Frame free?').includes('lakeside-a-frame'));
});

test('when the stay is not read, no amount is allowed in the draft', () => {
  const f = unreadFacts(['the dates']);
  assert.deepEqual(f.allowedCents, []);
  assert.match(f.lines.join('\n'), /NOT READ[\s\S]*UNKNOWN/);
  assert.equal(checkDraft('That would be about $468.00.', f.allowedCents).ok, false);
  assert.equal(checkDraft('Could you send the dates in full?', f.allowedCents).ok, true);
});
