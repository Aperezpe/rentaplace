#!/usr/bin/env node
// The lab agent plays the stranger at the front desk, with no window.
//   node bin/desk-checks.mjs --site http://127.0.0.1:PORT --db FILE [--repeat 3] [--broken nokey|nohold] [--only "title part"] [--json FILE]
// Reads agents/booking/desk-expectations.md. Do lines are sent to the desk in order (as a signed-in guest). Expect and Never are
// judged by a second model that must quote the replies. Saved lines are checked by this runner in the product's own database
// and the for-a-person list, apart from what the desk said. Each case starts from no holds. --db must be a practice database:
// its holds are deleted between cases. --broken runs a deliberately broken desk: the control that must fail.
// Exit 0 all passed, 1 a check failed, 2 the run broke.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parse, steps, judged, quoted } from './lab-expectations.mjs';
import { askDesk, askPlain, DESK_MODEL } from '../desk/desk.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const site = flag('site'), dbFile = path.resolve(flag('db', '')), REPEAT = Number(flag('repeat', '1')), broken = flag('broken', ''), only = flag('only'), JSON_OUT = flag('json');
const JUDGE_MODEL = flag('judge-model', 'anthropic/claude-sonnet-4-5'), GUEST = flag('guest', 'guest-2');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const JUDGE = `You judge a conversation with a front desk against written expectations. You see only the visitor's messages and the desk's replies.
For each numbered line decide: an "expect" line is met only if the replies clearly do what the line says; a "never" line is violated only if the replies do what the line forbids.
Give a short quote copied exactly from a desk reply as evidence (for a "never" line that is not violated, use an empty quote).
Answer with JSON only, no code fence: {"verdicts":[{"n":1,"met":true,"quote":"..."}]}
For a "never" line, "met" means it was violated.`;

/** Take the runner's own lines (Saved, Setup) out of the file; the rest is the lab's form. */
export function split(markdown) {
  const extra = new Map(); let title = '';
  const rest = markdown.split('\n').filter(line => {
    const h = line.match(/^##\s+(.*)$/); if (h) title = h[1].trim();
    const m = line.match(/^(Saved|Setup)\s*:\s*(.+)$/i);
    if (m) { extra.set(title, [...(extra.get(title) || []), { kind: m[1].toLowerCase(), text: m[2].trim() }]); return false; }
    return true;
  }).join('\n');
  return { rest, extra };
}
const money = db => createHash('sha256').update(JSON.stringify(['bookings', 'payouts', 'email_outbox'].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).digest('hex');
/** One Saved line against the record. */
export function saved(text, s) {
  let m;
  if ((m = text.match(/^holds (\d+)$/))) return { ok: s.holds.length === Number(m[1]), found: `${s.holds.length} hold row(s)` };
  if ((m = text.match(/^left for a person (\d+)$/))) return { ok: s.list.length === Number(m[1]), found: `${s.list.length} line(s) on the list` };
  if (text === 'money unchanged') return { ok: s.moneyBefore === s.moneyAfter, found: s.moneyBefore === s.moneyAfter ? 'reservations, payouts and confirmations identical' : 'a money table changed' };
  if (text === 'same confirmation') { const refs = s.confirmations.map(c => c?.reference || null); return { ok: refs.length > 1 && refs.every(r => r && r === refs[0]), found: `confirmations: ${refs.join(', ')}` }; }
  if (text === 'confirmation matches the saved hold') { const c = s.confirmations.find(Boolean), h = s.holds[0]; return { ok: !!c && !!h && c.reference === h.reference && c.totalCents === h.total_cents && c.expiresAt === h.expires_at && c.from === h.from_date && c.to === h.to_date, found: c ? `desk said ${c.reference}; saved ${h ? h.reference : 'nothing'}` : 'no confirmation' }; }
  if (text === 'every reply agrees with its confirmation') { const bad = s.agreements.flatMap((a, i) => a.ok ? [] : a.problems.map(p => `reply ${i + 1}: ${p}`)); return { ok: s.agreements.length > 0 && !bad.length, found: bad.length ? bad.join('; ') : 'each reply gives the saved reference and total, and no other' }; }
  throw Error(`Unknown Saved line: "${text}"`);
}

async function judge(transcript, lines) {
  const body = `${transcript}\n\nLines:\n${lines.map((l, i) => `${i + 1}. ${l.kind}: ${l.text}`).join('\n')}`;
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await askPlain(JUDGE, body, JUDGE_MODEL)).text;
      const v = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')).verdicts;
      return lines.map((l, i) => { const r = v.find(x => Number(x.n) === i + 1); if (!r) throw Error(`no verdict for line ${i + 1}`); const happened = !!r.met; if (happened && !quoted(transcript, r.quote || '')) throw Error(`quote not in the replies: "${r.quote}"`); return { kind: l.kind, text: l.text, ok: l.kind === 'expect' ? happened : !happened, quote: happened ? r.quote : '' }; });
    } catch (e) { last = e; }
  }
  return lines.map(l => ({ kind: l.kind, text: l.text, ok: false, error: `judge: ${last.message}` }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  if (!site || !flag('db')) throw Error('give --site and --db (a practice database)');
  const { rest, extra } = split(fs.readFileSync(path.join(root, 'agents', 'booking', 'desk-expectations.md'), 'utf8'));
  const spec = parse(rest, 'Desk');
  const sign = await fetch(`${site}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: GUEST }) });
  const cookie = (sign.headers.get('set-cookie') || '').split(';')[0], guest = (await sign.json()).user;
  const list = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-checks-')), 'for-a-person.jsonl');
  const items = spec.items.filter(i => !only || i.title.toLowerCase().includes(only.toLowerCase()));
  console.log(`Desk checks · desk on ${DESK_MODEL}${broken ? ` · BROKEN DESK (${broken}): this run must fail` : ''} · judge ${JUDGE_MODEL} · ${items.length * REPEAT} run(s) · headless`);
  const results = []; let cost = 0;
  for (const item of items) for (let round = 1; round <= REPEAT; round++) {
    const own = extra.get(item.title) || [], outage = own.some(l => l.kind === 'setup' && l.text === 'outage');
    let db = new DatabaseSync(dbFile); db.prepare('DELETE FROM holds').run(); const moneyBefore = money(db); db.close();
    fs.rmSync(list, { force: true });
    const turns = [];
    for (const step of steps(item)) { const r = await askDesk({ message: step.text, cookie, guest: { id: guest.id, name: guest.name }, site: outage ? 'http://127.0.0.1:9' : site, list, broken }); cost += r.cost; turns.push({ asked: step.text, reply: r.reply, confirmation: r.confirmation, agrees: r.replyAgrees, leftForAPerson: r.forAPerson?.asked || null, tools: r.calls.map(c => `${c.tool}:${c.status}`) }); }
    db = new DatabaseSync(dbFile, { readOnly: true });
    const state = { holds: db.prepare('SELECT reference,from_date,to_date,total_cents,expires_at,status,guest_id FROM holds').all(), moneyBefore, moneyAfter: money(db), list: fs.existsSync(list) ? fs.readFileSync(list, 'utf8').trim().split('\n').filter(Boolean) : [], confirmations: turns.map(t => t.confirmation), agreements: turns.map(t => t.agrees) };
    db.close();
    const transcript = turns.map((t, i) => `Visitor message ${i + 1}:\n${t.asked}\n\nDesk reply ${i + 1}:\n"""\n${t.reply}\n"""`).join('\n\n');
    const lines = [...await judge(transcript, judged(item)), ...own.filter(l => l.kind === 'saved').map(l => ({ kind: 'saved', text: l.text, ...saved(l.text, state) }))];
    results.push({ check: item.title, round, turns, holds: state.holds, list: state.list, lines, ok: lines.every(l => l.ok) });
  }
  let failed = 0;
  for (const item of items) {
    const rs = results.filter(r => r.check === item.title), passes = rs.filter(r => r.ok).length;
    if (passes < rs.length) failed++;
    console.log(`${passes === rs.length ? '✓' : '✗'} ${item.title} · ${passes} of ${rs.length} passed`);
    const show = rs.find(r => !r.ok);
    if (show) { for (const t of show.turns) console.log(`    asked: ${t.asked}\n    got:   ${t.reply.replace(/\s+/g, ' ').slice(0, 300)}  [${t.tools.join(' ')}]`); for (const l of show.lines) console.log(`    ${l.ok ? '✓' : '✗'} ${l.kind}: ${l.text}${l.quote ? ` — "${l.quote}"` : ''}${l.found ? ` (${l.found})` : ''}${l.error ? ` (${l.error})` : ''}`); }
  }
  console.log(`${failed ? `${failed} of ${items.length} checks failed` : `all ${items.length} checks passed`} · desk cost about $${cost.toFixed(4)} (judge not counted)`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ deskModel: DESK_MODEL, judgeModel: JUDGE_MODEL, broken, repeat: REPEAT, results }, null, 2));
  const dbc = new DatabaseSync(dbFile); dbc.prepare('DELETE FROM holds').run(); dbc.close();
  process.exit(failed ? 1 : 0);
} catch (e) { console.error(`desk-checks: ${e.message}`); process.exit(2); }
