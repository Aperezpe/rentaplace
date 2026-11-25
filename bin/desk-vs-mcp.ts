#!/usr/bin/env node
// Three desk visitors against three MCP visitors, same goal, same model, run three at a time per side.
// Desk: a fresh visitor agent whose only tool sends messages to /desk; its model and the desk model both count (desk cost from receipts).
// MCP: a fresh agent with only the tools /mcp lists, signed in as its guest; the visitor's agent pays (cost from Pi).
// Each visit is checked in the database: one active hold on the right stay, no reservation. The app must be running.
//   npm run desk-vs-mcp -- [--model anthropic/claude-haiku-5-5]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, DESK_DIR, PORT, ROOT, addDays, today } from '../src/config.ts';
import { DESK_MODEL } from '../src/desk.ts';

const { values: opt } = parseArgs({ options: { model: { type: 'string', default: DESK_MODEL } } });
const BASE = `http://127.0.0.1:${PORT}`, SLUG = 'lakeside-a-frame', HOME = 'Lakeside A-Frame';
const goal = (from: string, to: string) => `Find the price of ${HOME} (${SLUG}) from ${from} to ${to} for 2 guests and put the stay on hold. Don't reserve or pay. Tell me the total and the hold reference.`;
const ro = new DatabaseSync(DB_PATH, { readOnly: true });

async function signIn(id: string) {
  const res = await fetch(`${BASE}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) });
  if (!res.ok) throw new Error(`sign-in failed for ${id}`);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('rap_session='))!;
}
/** Six guests with no holds, and six free 3-night stays far enough out that nothing else uses them. */
function pick() {
  const guests = (ro.prepare("SELECT id FROM users u WHERE role='guest' AND CAST(substr(id,7) AS INT) BETWEEN 100 AND 400 AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.guest_id=u.id) ORDER BY CAST(substr(id,7) AS INT) LIMIT 6").all() as any[]).map(r => r.id);
  const home = ro.prepare('SELECT id FROM listings WHERE slug=?').get(SLUG) as any, stays: { from: string; to: string }[] = [];
  for (let w = 120; stays.length < 6; w++) {
    const from = addDays(today(), w * 7), to = addDays(from, 3);
    const busy = ro.prepare("SELECT 1 FROM holds WHERE listing_id=? AND status='active' AND from_date<? AND to_date>? UNION SELECT 1 FROM bookings WHERE listing_id=? AND status IN ('confirmed','pending','completed') AND from_date<? AND to_date>? UNION SELECT 1 FROM blocks WHERE listing_id=? AND from_date<? AND to_date>?").get(home.id, to, from, home.id, to, from, home.id, to, from);
    if (!busy) stays.push({ from, to });
  }
  return { guests, stays, homeId: home.id };
}
type Visit = { side: 'desk' | 'mcp'; guest: string; from: string; to: string; ms: number; visitorUsd: number; visitorTokens: number; toolCalls: number;
  deskMs: number; deskUsd: number; deskTokens: number; reply: string; error?: string };
const SYSTEM = 'You act for a guest on a vacation rental site. You are signed in as them. Use only your tools.';

/** A fresh Pi agent with one extension as its only tools. Returns wall time, its own model's cost and tokens, and desk request IDs. */
function agent(extension: string, env: Record<string, string>, task: string) {
  return new Promise<{ ms: number; usd: number; tokens: number; toolCalls: number; reply: string; deskRequestIds: string[]; error?: string }>(done => {
    const args = ['--mode', 'json', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-themes',
      '--no-builtin-tools', '-e', resolve(ROOT, extension), '--thinking', 'off', '--model', opt.model!, task];
    const t = performance.now();
    const child = spawn('pi', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, PI_SKIP_VERSION_CHECK: '1' } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const kill = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', () => {
      clearTimeout(kill);
      let usd = 0, tokens = 0, toolCalls = 0, reply = ''; const deskRequestIds: string[] = [];
      for (const line of out.split('\n')) {
        let e: any; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'tool_execution_end') { toolCalls++; if (e.result?.details?.requestId) deskRequestIds.push(e.result.details.requestId); }
        if (e.type === 'message_end' && e.message?.role === 'assistant') {
          const u = e.message.usage ?? {};
          usd += u.cost?.total || 0; tokens += (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
          reply = (e.message.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') || reply;
        }
      }
      done({ ms: Math.round(performance.now() - t), usd, tokens, toolCalls, reply, deskRequestIds, error: reply ? undefined : err.trim().split('\n').at(-1) });
    });
  });
}
const receipts = () => readFileSync(join(DESK_DIR, 'receipts.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

/** Desk side: the visitor's agent talks to the desk, and the desk's own model does the work. Both models count. */
async function deskVisit(guest: string, from: string, to: string): Promise<Visit> {
  const cookie = await signIn(guest);
  const a = await agent('agents/desk-visitor/ask-desk.ts', { DESK_URL: `${BASE}/desk`, DESK_VISITOR_COOKIE: cookie, DESK_VISITOR_SYSTEM: SYSTEM }, goal(from, to));
  const mine = receipts().filter(r => a.deskRequestIds.includes(r.requestId));
  return { side: 'desk', guest, from, to, ms: a.ms, visitorUsd: a.usd, visitorTokens: a.tokens, toolCalls: a.toolCalls,
    deskMs: mine.reduce((s, r) => s + r.durationMs, 0), deskUsd: mine.reduce((s, r) => s + r.costUsd, 0), deskTokens: mine.reduce((s, r) => s + r.promptTokens, 0), reply: a.reply, error: a.error };
}
/** MCP side: the visitor's agent calls the site's tools itself; no model runs on the site. */
async function mcpVisit(guest: string, from: string, to: string): Promise<Visit> {
  const cookie = await signIn(guest);
  const a = await agent('agents/mcp-visitor/bridge.ts', { MCP_URL: `${BASE}/mcp`, MCP_COOKIE: cookie, MCP_SYSTEM: SYSTEM }, goal(from, to));
  return { side: 'mcp', guest, from, to, ms: a.ms, visitorUsd: a.usd, visitorTokens: a.tokens, toolCalls: a.toolCalls, deskMs: 0, deskUsd: 0, deskTokens: 0, reply: a.reply, error: a.error };
}

const { guests, stays, homeId } = pick();
if (guests.length < 6) throw new Error('Need six guests with no holds.');
const before = Number((ro.prepare('SELECT coalesce(max(rowid),0) m FROM holds').get() as any).m);
// Seed bookings carry future created_at dates, so new reservations are found by row, not by date.
const bookingsBefore = Number((ro.prepare('SELECT coalesce(max(rowid),0) m FROM bookings').get() as any).m);
console.log(`Desk vs MCP on ${opt.model}: 3 visitors each side, run 3 at a time. Goal: price + hold, no reservation.\n`);
const desk = await Promise.all([0, 1, 2].map(i => deskVisit(guests[i], stays[i].from, stays[i].to)));
const mcp = await Promise.all([3, 4, 5].map(i => mcpVisit(guests[i], stays[i].from, stays[i].to)));

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const check = (v: Visit) => {
  const holds = db.prepare('SELECT * FROM holds WHERE rowid>? AND guest_id=?').all(before, v.guest) as any[];
  const booked = (db.prepare('SELECT COUNT(*) n FROM bookings WHERE rowid>? AND guest_id=?').get(bookingsBefore, v.guest) as any).n;
  const h = holds[0];
  const right = holds.length === 1 && h.listing_id === homeId && h.from_date === v.from && h.to_date === v.to && h.status === 'active';
  const reported = !!h && v.reply.toUpperCase().includes(h.reference) && v.reply.replace(/,/g, '').includes((h.total_cents / 100).toFixed(2).replace(/\.00$/, ''));
  return { ok: right && booked === 0, reported, ref: h?.reference ?? '-' };
};
const fmt = (n: number) => `$${n.toFixed(5)}`, sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
// Time: the visit's wall time already contains the desk's time, so it is split, not added twice: desk model + visitor's own share.
console.log('| side | guest | wall time | of which desk | visitor model $ | desk model $ | total $ | prompt tokens (visitor + desk) | tool calls | hold right | reply ref+total |\n|---|---|---|---|---|---|---|---|---|---|---|');
for (const v of [...desk, ...mcp]) { const c = check(v); console.log(`| ${v.side} | ${v.guest} | ${sec(v.ms)} | ${v.side === 'desk' ? sec(v.deskMs) : '-'} | ${fmt(v.visitorUsd)} | ${v.side === 'desk' ? fmt(v.deskUsd) : '-'} | ${fmt(v.visitorUsd + v.deskUsd)} | ${v.visitorTokens} + ${v.deskTokens} | ${v.toolCalls} | ${c.ok ? `yes ${c.ref}` : 'NO'} | ${c.reported ? 'yes' : 'no'} |${v.error ? ` ${v.error}` : ''}`); }
const sum = (vs: Visit[]) => ({ ms: vs.reduce((s, v) => s + v.ms, 0) / vs.length, deskMs: vs.reduce((s, v) => s + v.deskMs, 0) / vs.length, visitor: vs.reduce((s, v) => s + v.visitorUsd, 0), desk: vs.reduce((s, v) => s + v.deskUsd, 0), ok: vs.filter(v => check(v).ok).length });
const [d, m] = [sum(desk), sum(mcp)];
console.log(`\ndesk: avg ${sec(d.ms)} per visit (${sec(d.deskMs)} in the desk), total ${fmt(d.visitor + d.desk)} = visitor ${fmt(d.visitor)} + desk ${fmt(d.desk)}, ${d.ok}/3 holds right`);
console.log(`mcp:  avg ${sec(m.ms)} per visit, total ${fmt(m.visitor)} (visitor only), ${m.ok}/3 holds right`);
