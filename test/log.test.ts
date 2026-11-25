import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.ts';
import { createApp } from '../src/server.ts';
import { LOG_DIR } from '../src/config.ts';

const lines = () => readFileSync(join(LOG_DIR, 'app.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const byId = (id: string | null) => lines().find(l => l.requestId === id);

test('a failed request logs allow-listed query and body fields and the 4xx code, never private data', async () => {
  const { db } = fixture();
  const { server } = createApp(db);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const quote = await fetch(`${base}/api/quote?slug=lakeside-a-frame&from=2026-11-13&to=2026-11-10&guests=2&email=mira@example.test`);
    assert.equal(quote.status, 400);
    await new Promise(r => setTimeout(r, 20));
    const q = byId(quote.headers.get('x-request-id'));
    assert.deepEqual(q.query, { slug: 'lakeside-a-frame', from: '2026-11-13', to: '2026-11-10', guests: '2' });
    assert.equal(typeof q.errorCode, 'string');

    const hold = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'lakeside-a-frame', from: '2026-11-10', to: '2026-11-13', guests: 2, guestName: 'Mira Valewood', guestEmail: 'mira@example.test', cardNumber: '4242 4242 4242 4242', message: 'private text' }) });
    assert.ok(hold.status >= 400 && hold.status < 500);
    await new Promise(r => setTimeout(r, 20));
    const h = byId(hold.headers.get('x-request-id'));
    assert.deepEqual(h.body, { slug: 'lakeside-a-frame', from: '2026-11-10', to: '2026-11-13', guests: 2 });
    assert.equal(typeof h.errorCode, 'string');

    const all = readFileSync(join(LOG_DIR, 'app.log'), 'utf8');
    assert.ok(!/mira@|Valewood|4242 4242|private text/.test(all), 'no email, name, card or message anywhere in the log');

    const ok = await fetch(`${base}/api/quote?slug=lakeside-a-frame&from=2026-11-10&to=2026-11-13&guests=2`);
    await new Promise(r => setTimeout(r, 20));
    const o = byId(ok.headers.get('x-request-id'));
    assert.equal(o.status, 200);
    assert.ok(!('query' in o) && !('errorCode' in o), 'successful requests log as before');
  } finally { server.close(); db.close(); }
});
