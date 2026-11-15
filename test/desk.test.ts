import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { agrees, deskKnowledge, internalKnowledge, leaks, withoutSources } from '../desk/desk.mjs';
import { saved, split } from '../bin/desk-checks.mjs';
import { requestKey } from '../desk/request-key.mjs';

const confirmation = { reference: 'HOLD-45830C59', from: '2026-11-16', to: '2026-11-19', guests: 2, totalCents: 46800, expiresAt: '2026-11-16T08:00:00.000Z' };

test('source notes are cut from a line; the words before them stay', () => {
  assert.equal(withoutSources('- Placing a hold never asks for a card. (commit eba6d8c; `docs/api.md`, Price and availability)'), '- Placing a hold never asks for a card.');
  assert.equal(withoutSources('- **Active hold**: runs out by itself. (Code: `assertAvailable` in `src/domain/bookings.ts`.)'), '- **Active hold**: runs out by itself.');
  assert.equal(withoutSources('- Minimum stay is open. (tracker card `holiday-stay-length`, On hold)'), '- Minimum stay is open.');
  assert.equal(withoutSources('- A hold (the 24-hour kind) keeps the nights.'), '- A hold (the 24-hour kind) keeps the nights.', 'ordinary brackets are not a source note');
});

test('the desk knows the Job, the glossary and the customer-facing memories, and none of the internal ones', () => {
  const desk = deskKnowledge(), memories = fs.readFileSync('agents/booking/memories.md', 'utf8');
  const internal = memories.split('## Customer-facing')[0].split('\n').filter(l => l.startsWith('- '));
  assert.ok(internal.length >= 5);
  for (const line of internal) assert.equal(desk.includes(line.slice(2, 60)), false, `internal memory reached the desk: ${line.slice(0, 60)}`);
  assert.ok(desk.includes('Placing a hold never asks for a card'));
  assert.ok(desk.includes('You have exactly two tools'));
  assert.deepEqual(leaks(desk), [], 'no commit hash, path, test or function name is in what the desk knows');
});

test('control: the whole internal Booking does carry those marks, and the leak finder sees them in a reply', () => {
  assert.ok(leaks(internalKnowledge()).length > 5);
  assert.deepEqual(leaks('That changed in commit 374848f, see `createBooking`.').sort(), ['374848f', 'createBooking']);
  assert.deepEqual(leaks('A hold keeps the nights and the price for 24 hours.'), []);
});

test('the request key is made from the request: the same request gives the same key, any difference another', () => {
  const p = { slug: 'lakeside-a-frame', from: '2026-11-16', to: '2026-11-19', guests: 2 };
  const key = requestKey('guest-1', p);
  assert.match(key, /^desk-[0-9a-f]{32}$/);
  assert.equal(requestKey('guest-1', { ...p, guests: '2' }), key, 'a number sent as text is the same request');
  for (const other of [requestKey('guest-2', p), requestKey('guest-1', { ...p, to: '2026-11-20' }), requestKey('guest-1', { ...p, guests: 3 }), requestKey('guest-1', { ...p, slug: 'city-loft' })]) assert.notEqual(other, key);
});

test('the spoken reply agrees with the confirmation when it gives the saved reference and total, and no other', () => {
  assert.deepEqual(agrees('Your hold is placed. Reference HOLD-45830C59, total $468.00, runs out tomorrow.', confirmation), { ok: true, problems: [] });
  assert.equal(agrees('Held: hold-45830c59 for $468.', confirmation).ok, true, 'case and a whole-dollar amount are the same facts');
  assert.deepEqual(agrees('Your hold HOLD-45830C59 is placed for $486.00.', confirmation).problems, ['the reply does not give the saved total $468.00']);
  assert.deepEqual(agrees('Your hold HOLD-AAAA1111 is placed for $468.00.', confirmation).problems, ['the reply does not give the saved reference HOLD-45830C59', 'the reply gives another reference: HOLD-AAAA1111']);
  assert.equal(agrees('Your hold is placed.', confirmation).ok, false);
});

test('with nothing saved, a reply that gives a hold reference disagrees; a reply about price or a refusal agrees', () => {
  assert.deepEqual(agrees('Your hold is confirmed. Reference HOLD-C7453750.', null), { ok: false, problems: ['the reply gives HOLD-C7453750 and no hold was saved'] });
  assert.equal(agrees('That stay costs $468.00 in total.', null).ok, true);
  assert.equal(agrees('The desk cannot make a refund. It has been left for a person.', null).ok, true);
});

test('desk checks: the runner takes its own Saved and Setup lines out and leaves the lab form', () => {
  const { rest, extra } = split('# T\n\n## One\nDo (Desk): hello\nExpect (Desk): greets\nSaved: holds 0\nSetup: outage\n\n## Two\nDo (Desk): hi\nNever (Desk): lies\nSaved: money unchanged\n');
  assert.equal(/Saved|Setup/.test(rest), false);
  assert.deepEqual(extra.get('One'), [{ kind: 'saved', text: 'holds 0' }, { kind: 'setup', text: 'outage' }]);
  assert.deepEqual(extra.get('Two'), [{ kind: 'saved', text: 'money unchanged' }]);
});

test('desk checks: each Saved line is read from the record, and each can fail', () => {
  const row = { reference: 'HOLD-45830C59', from_date: '2026-11-16', to_date: '2026-11-19', total_cents: 46800, expires_at: '2026-11-16T08:00:00.000Z' };
  const state = { holds: [row], list: [], moneyBefore: 'a', moneyAfter: 'a', confirmations: [confirmation, confirmation], agreements: [{ ok: true, problems: [] }, { ok: true, problems: [] }] };
  for (const line of ['holds 1', 'left for a person 0', 'money unchanged', 'same confirmation', 'confirmation matches the saved hold', 'every reply agrees with its confirmation']) assert.equal(saved(line, state).ok, true, line);
  assert.equal(saved('holds 1', { ...state, holds: [] }).ok, false);
  assert.equal(saved('money unchanged', { ...state, moneyAfter: 'b' }).ok, false);
  assert.equal(saved('same confirmation', { ...state, confirmations: [confirmation, { ...confirmation, reference: 'HOLD-OTHER001' }] }).ok, false);
  assert.equal(saved('confirmation matches the saved hold', { ...state, holds: [] }).ok, false, 'said held, saved nothing');
  assert.equal(saved('confirmation matches the saved hold', { ...state, holds: [{ ...row, total_cents: 50000 }] }).ok, false);
  assert.equal(saved('left for a person 1', state).ok, false);
  assert.equal(saved('every reply agrees with its confirmation', { ...state, agreements: [{ ok: true, problems: [] }, { ok: false, problems: ['the reply gives HOLD-X and no hold was saved'] }] }).ok, false);
  assert.throws(() => saved('something else', state), /Unknown Saved line/);
});
