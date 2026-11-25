import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, guest, otherGuest, input } from './helpers.ts';
import { createApp } from '../src/server.ts';
import { createBooking } from '../src/domain/bookings.ts';
import { createTicket } from '../src/domain/support.ts';
import { OUTBOX_DIR } from '../src/config.ts';
import { appGet, customerFacing, datesIn, draftPath, draftTicket, homeIn, type Ask } from '../src/drafts.ts';
import { issueRows } from '../src/issues.ts';

const memories = readFileSync('agents/booking/memories.md', 'utf8');
const internal = memories.slice(memories.indexOf('## Internal engineering'), memories.indexOf('## Customer-facing'));

async function world() {
  const dir = mkdtempSync(join(tmpdir(), 'rap-drafts-'));
  const dbPath = join(dir, 'app.db');
  const { db } = fixture(dbPath);
  db.prepare("UPDATE listings SET title='Lakeside A-Frame' WHERE slug='lakeside-a-frame'").run();
  const booking = createBooking(db, input, guest).booking as any;
  const t = (body: any, user?: any) => createTicket(db, { name: 'Mira Valewood', email: 'mira@example.test', ...body }, user).id;
  const ids = {
    byRef: t({ subject: 'Charge question', message: `Why is my total what it is for ${booking.reference}?` }, guest),
    quote: t({ subject: 'Price for a weekend', message: 'How much is Lakeside A-Frame from Nov 20 to Nov 23 for 2 guests?' }),
    quoteNights: t({ subject: 'Price', message: 'What would 3 nights at the Lakeside A-Frame cost from 2026-11-20 for two guests?' }),
    nothing: t({ subject: 'Fees', message: 'Why are your fees so high?' }),
    stranger: t({ subject: 'Total?', message: `What is the total for ${booking.reference}?`, email: 'ellis@example.test' }, otherGuest),
    notPricing: t({ subject: 'Dates', message: 'Can I change my dates?' }, guest),
  };
  const tags = Object.entries(ids).map(([k, id]) => JSON.stringify({ ticketId: id, owner: k === 'notPricing' ? 'booking' : 'pricing', money: true, unsure: false, why: [], moneyP: 0.9, ownerConfidence: 0.9, model: 'jev-1.14.0', at: 'x' }));
  writeFileSync(join(dir, 'support-tags.jsonl'), tags.join('\n') + '\n');
  const { server } = createApp(db);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const get = appGet(`http://127.0.0.1:${(server.address() as any).port}`);
  const calls: string[][] = [];
  const ask: Ask = async args => { calls.push(args); return 'Hello, here is your answer.'; };
  const opts = { dbPath, tagsDir: dir, draftsDir: join(dir, 'drafts'), get, ask };
  return { db, dir, ids, booking, calls, opts, close: () => { server.close(); db.close(); } };
}
const fact = (d: any, name: string) => d.facts.find((f: any) => f.fact === name);

test('a reservation reference: every fact comes from the app, amounts as saved on the reservation', async () => {
  const w = await world();
  try {
    const d = await draftTicket(w.ids.byRef, w.opts);
    assert.deepEqual(d.stay, { kind: 'reservation', via: 'reference', reference: w.booking.reference });
    assert.ok(d.facts.every(f => f.value && !f.unknown), JSON.stringify(d.facts));
    assert.equal(fact(d, 'total').value, `$${(w.booking.total_cents / 100).toFixed(2)}`);
    assert.equal(fact(d, 'cleaning').value, `$${(w.booking.cleaning_cents / 100).toFixed(2)}`);
    assert.equal(fact(d, 'dates').value, '2026-11-10 to 2026-11-13 (checkout 2026-11-13)');
  } finally { w.close(); }
});

test('no reservation but a home, dates and guests: the app quotes the stay', async () => {
  const w = await world();
  try {
    for (const id of [w.ids.quote, w.ids.quoteNights]) {
      const d = await draftTicket(id, w.opts);
      assert.equal(d.stay.kind, 'quote');
      assert.deepEqual([fact(d, 'home').value, fact(d, 'dates').value, fact(d, 'guests').value], ['Lakeside A-Frame', '2026-11-20 to 2026-11-23 (checkout 2026-11-23)', '2']);
      assert.equal(fact(d, 'nightly rate').value, '$110.00 weeknight x 1, $140.00 Friday and Saturday x 2; accommodation $390.00');
      assert.deepEqual(['cleaning', 'service fee', 'taxes', 'total'].map(n => fact(d, n).value), ['$60.00', '$54.00', '$36.00', '$540.00']);
    }
  } finally { w.close(); }
});

test('neither a reservation nor a home + stay: every fact is unknown, with the reason', async () => {
  const w = await world();
  try {
    const d = await draftTicket(w.ids.nothing, w.opts);
    assert.equal(d.stay.kind, 'unknown');
    assert.ok(d.facts.length >= 10 && d.facts.every(f => !f.value && /No home \+ stay to quote: the ticket names no home; no dates; no guest count/.test(f.unknown!)), JSON.stringify(d.facts[0]));
  } finally { w.close(); }
});

test("another guest's reference reveals nothing about that reservation", async () => {
  const w = await world();
  try {
    const d = await draftTicket(w.ids.stranger, w.opts);
    assert.ok(d.facts.every(f => !f.value && f.unknown!.includes('belongs to a different guest')), JSON.stringify(d.facts[0]));
    assert.ok(!w.calls[0].join(' ').includes(String(w.booking.total_cents / 100)));
  } finally { w.close(); }
});

test('Booking gets the question, the facts and only the customer-facing memories, with no tools', async () => {
  const w = await world();
  try {
    await draftTicket(w.ids.byRef, w.opts);
    const args = w.calls[0], prompt = args.join('\n');
    for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-context-files']) assert.ok(args.includes(flag), flag);
    assert.ok(prompt.includes(customerFacing()));
    assert.ok(!prompt.includes('Internal engineering'));
    for (const line of internal.split('\n').filter(l => l.startsWith('- '))) assert.ok(!prompt.includes(line.slice(2, 60)), line.slice(0, 60));
    assert.ok(prompt.includes('Why is my total what it is for') && prompt.includes('- total: $'));
    assert.ok(!/mira@|Valewood/.test(prompt), 'no guest name or email');
  } finally { w.close(); }
});

test('the draft is saved beside the ticket; ticket, tags and outbox are unchanged; nothing is sent', async () => {
  const w = await world();
  try {
    const snap = () => createHash('sha256').update(JSON.stringify(w.db.prepare('SELECT * FROM support_tickets ORDER BY id').all())).update(readFileSync(join(w.dir, 'support-tags.jsonl'))).update(JSON.stringify(w.db.prepare('SELECT * FROM email_outbox ORDER BY id').all())).digest('hex');
    const outbox = () => existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR).length : 0;
    const before = snap(), files = outbox();
    await draftTicket(w.ids.byRef, w.opts);
    const saved = JSON.parse(readFileSync(draftPath(w.ids.byRef, w.opts.draftsDir), 'utf8'));
    assert.deepEqual(Object.keys(saved), ['ticketId', 'question', 'stay', 'facts', 'reply', 'model', 'at']);
    assert.equal(saved.reply, 'Hello, here is your answer.');
    assert.equal(saved.question.subject, 'Charge question');
    assert.equal(snap(), before);
    assert.equal(outbox(), files);
  } finally { w.close(); }
});

test('a ticket that is not tagged pricing is refused and nothing is written', async () => {
  const w = await world();
  try {
    await assert.rejects(draftTicket(w.ids.notPricing, w.opts), /tagged booking, not pricing/);
    assert.equal(w.calls.length, 0);
    assert.ok(!existsSync(draftPath(w.ids.notPricing, w.opts.draftsDir)));
  } finally { w.close(); }
});

test('the Issues row points at the draft without carrying the message', async () => {
  const w = await world();
  try {
    await draftTicket(w.ids.byRef, w.opts);
    const rows = issueRows(w.opts.dbPath, w.dir, w.opts.draftsDir);
    const row = rows.find(r => r.id === w.ids.byRef)!;
    assert.equal(row.draft_file, draftPath(w.ids.byRef, w.opts.draftsDir));
    assert.ok(!JSON.stringify(rows).includes('Why is my total'));
  } finally { w.close(); }
});

test('reading dates and homes from text', () => {
  assert.deepEqual(datesIn('from Nov 20 to Nov 23', '2026-11-09'), ['2026-11-20', '2026-11-23']);
  assert.deepEqual(datesIn('Nov 20-23', '2026-11-09'), ['2026-11-20', '2026-11-23']);
  assert.deepEqual(datesIn('on 3 January', '2026-11-09'), ['2027-01-03']);
  const homes = [{ slug: 'pine-hollow-cabin', title: 'Pine Hollow Cabin' }, { slug: 'woodland-loft-1', title: 'Woodland Loft' }, { slug: 'woodland-loft-2', title: 'Woodland Loft' }];
  assert.deepEqual(homeIn('a weekend at Pine Hollow', homes), { slug: 'pine-hollow-cabin', title: 'Pine Hollow Cabin' });
  assert.match((homeIn('the Woodland Loft', homes) as any).reason, /2 homes are called Woodland Loft/);
});
