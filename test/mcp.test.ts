import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.ts';
import { makeSession } from '../src/auth.ts';
import { fixture, guest, otherGuest, host, input } from './helpers.ts';
// The real SDK client against POST /mcp: sign-in, the shared rate limit, and refusals as tool errors with the API's codes.

async function serve(limits = { maxChars: 2000, perMinute: 5, dailyBudgetUsd: 1 }, deskAsk?: any) {
  const { db } = fixture();
  const { server } = createApp(db, undefined, { deskLimits: limits, deskAsk });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const connect = async (who: string | null) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: who ? { cookie: `rap_session=${makeSession(who)}` } : {} } }));
    return client;
  };
  return { db, server, base, connect };
}
const errorOf = (r: any) => (r.isError ? JSON.parse(r.content[0].text).error : null);
const stay = { slug: input.slug, from: input.from, to: input.to, guests: 2 };

test('the MCP server lists exactly the desk\'s three tools', async () => {
  const { server, db, connect } = await serve();
  try {
    const client = await connect(null);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['look_up_price', 'place_hold', 'read_home_rules']);
    await client.close();
  } finally { server.close(); db.close(); }
});

test('same sign-in: without a guest session every tool refuses with SIGN_IN_REQUIRED, a host with WRONG_ACCOUNT', async () => {
  const { server, db, connect } = await serve();
  try {
    const anon = await connect(null);
    for (const [name, args] of [['look_up_price', stay], ['read_home_rules', { slug: input.slug, topic: 'pets' }], ['place_hold', stay]] as const)
      assert.equal(errorOf(await anon.callTool({ name, arguments: args })).code, 'SIGN_IN_REQUIRED', name);
    const asHost = await connect(host.id);
    assert.equal(errorOf(await asHost.callTool({ name: 'place_hold', arguments: stay })).code, 'WRONG_ACCOUNT');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM holds').get() as any).n, 0);
  } finally { server.close(); db.close(); }
});

test('tools act as the signed-in guest; domain refusals keep the API\'s codes', async () => {
  const { server, db, connect } = await serve({ maxChars: 2000, perMinute: 100, dailyBudgetUsd: 1 });
  try {
    const me = await connect(guest.id), other = await connect(otherGuest.id);
    const price = await me.callTool({ name: 'look_up_price', arguments: stay });
    assert.equal(price.isError, undefined); assert.equal((price.structuredContent as any).quote.totalCents > 0, true);
    const held = await me.callTool({ name: 'place_hold', arguments: stay });
    const hold = (held.structuredContent as any).hold;
    assert.equal(hold.guest_id, guest.id);
    const again = await me.callTool({ name: 'place_hold', arguments: stay });
    assert.deepEqual([(again.structuredContent as any).hold.id, (again.structuredContent as any).replayed], [hold.id, true], 'same stay, same hold');
    assert.equal(errorOf(await other.callTool({ name: 'place_hold', arguments: stay })).code, 'DATES_UNAVAILABLE');
    assert.equal(errorOf(await me.callTool({ name: 'read_home_rules', arguments: { slug: 'fern-cottage', topic: 'pets' } })).code, 'NO_PASSAGE');
    assert.equal((await me.callTool({ name: 'read_home_rules', arguments: { slug: input.slug, topic: 'smoking' } }) as any).structuredContent.passage.text, 'No smoking indoors.');
    assert.equal(errorOf(await me.callTool({ name: 'look_up_price', arguments: { ...stay, slug: 'nowhere' } })).code, 'NOT_FOUND');
    for (const [slug, from] of [['courtyard-loft', '2026-12-01'], ['fern-cottage', '2026-12-01'], [input.slug, '2026-12-20']])
      await me.callTool({ name: 'place_hold', arguments: { slug, from, to: from.replace(/\d\d$/, d => String(Number(d) + 2).padStart(2, '0')), guests: 2 } });
    assert.equal(errorOf(await me.callTool({ name: 'place_hold', arguments: { slug: 'courtyard-loft', from: '2027-01-04', to: '2027-01-06', guests: 2 } })).code, 'HOLD_LIMIT');
  } finally { server.close(); db.close(); }
});

test('same rate limit as the desk, one shared count per visitor; refusal is DESK_RATE_LIMITED as a tool error', async () => {
  const deskAsk = async () => ({ text: '{"reply":"ok","done":true}', costUsd: 0 });
  const { server, db, base, connect } = await serve({ maxChars: 2000, perMinute: 3, dailyBudgetUsd: 1 }, deskAsk);
  try {
    const desk = () => fetch(`${base}/desk`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `rap_session=${makeSession(guest.id)}` }, body: JSON.stringify({ message: 'hi' }) });
    assert.equal((await desk()).status, 200);
    const me = await connect(guest.id);
    await me.listTools();   // listing tools is not a call and does not count
    assert.equal((await me.callTool({ name: 'look_up_price', arguments: stay })).isError, undefined);
    assert.equal((await me.callTool({ name: 'look_up_price', arguments: stay })).isError, undefined);
    const limited = errorOf(await me.callTool({ name: 'look_up_price', arguments: stay }));
    assert.equal(limited.code, 'DESK_RATE_LIMITED'); assert.match(limited.message, /3 messages or tool calls a minute/);
    assert.equal((await desk()).status, 429, 'the desk shares the count');
    assert.equal((await (await connect(otherGuest.id)).callTool({ name: 'look_up_price', arguments: stay })).isError, undefined, 'per visitor');
  } finally { server.close(); db.close(); }
});

test('GET and DELETE /mcp are 405: stateless, POST only', async () => {
  const { server, db, base } = await serve();
  try { for (const method of ['GET', 'DELETE']) assert.equal((await fetch(`${base}/mcp`, { method })).status, 405); }
  finally { server.close(); db.close(); }
});
