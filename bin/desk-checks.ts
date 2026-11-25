#!/usr/bin/env node
// Desk checks: runs agents/booking/desk-expectations.md against the real desk (POST /desk, real model), each case N times.
// Every run uses its own scratch folder: test database, desk folder, logs and outbox. The dev database is never opened.
//   Do (Visitor as guest-N): posted to /desk signed in as that guest.
//   Run: in a case, NAME=value sets an env var for that case only (e.g. RAP_DESK_TOOLS_BASE); in Before, a shell command.
//   Expect / Never: judged by a second model from the desk's replies; its quote must be found in a reply.
//   Saved: checked in code against the test database and the run's desk folder, apart from anything the desk said.
//     A Saved clause the runner does not understand fails the case; it never passes by default.
//   --broken nohold: the desk says the stay is held but saves nothing. --broken nokey: holds are placed with no request key.
//   Both exist to prove the checks catch a broken desk; a broken desk should fail.
//   npm run desk-checks -- [--repeat 3] [--judge-model anthropic/claude-sonnet-4-5] [--case <words>] [--broken nohold|nokey]
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse, quoted, saved, steps, judged } from './lab-expectations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'agents/booking/desk-expectations.md');
const { values: opt } = parseArgs({ options: { repeat: { type: 'string', default: '3' }, 'judge-model': { type: 'string', default: 'anthropic/claude-sonnet-4-5' }, case: { type: 'string' }, broken: { type: 'string' } } });
if (opt.broken && !['nohold', 'nokey'].includes(opt.broken)) throw new Error('--broken takes nohold or nokey.');
const REPEAT = Number(opt.repeat), JUDGE_MODEL = opt['judge-model']!;

// ---------- a scratch world, set before any app module reads its paths ----------
const work = mkdtempSync(join(tmpdir(), 'rap-desk-checks-'));
const TEST_DB = join(work, 'test.db'), DEV_DB = resolve(ROOT, 'data/rentaplace.db');
Object.assign(process.env, { RAP_DB: TEST_DB, RAP_LOG_DIR: join(work, 'logs'), RAP_OUTBOX_DIR: join(work, 'outbox'), RAP_DESK_DIR: join(work, 'desk'), RAP_WATCHER_DIR: join(work, 'watcher'), RAP_LOG_STDOUT: '0' });
delete process.env.RAP_DESK_TOOLS_BASE;
if (opt.broken) process.env.RAP_DESK_BROKEN = opt.broken; else delete process.env.RAP_DESK_BROKEN;
if (resolve(process.env.RAP_DB!) === DEV_DB) throw new Error('Refusing to run: the test database is the dev database.');

const spec: { before: any[]; items: { title: string; lines: any[] }[] } = parse(readFileSync(FILE, 'utf8'), 'Desk', { caseRun: true });
const cases = spec.items.filter(i => !opt.case || i.title.toLowerCase().includes(opt.case.toLowerCase()));

function seed() {
  for (const l of spec.before.filter((l: any) => l.kind === 'run')) {
    const cmd = l.text.replaceAll("<the run's test database>", JSON.stringify(TEST_DB));
    if (/<[^>]+>/.test(cmd)) throw new Error(`Line ${l.line}: unknown placeholder in "${l.text}".`);
    execSync(cmd, { cwd: ROOT, env: process.env, stdio: 'ignore' });
  }
  if (!existsSync(TEST_DB)) throw new Error('Before did not create the test database.');
}
seed();   // the schema must exist before the app modules open it
const { createApp } = await import('../src/server.ts');
const { openDatabase } = await import('../src/db.ts');
const { makeSession } = await import('../src/auth.ts');
const DESK_DIR = process.env.RAP_DESK_DIR!;

// ---------- records: snapshots and Saved clauses ----------
type DB = ReturnType<typeof openDatabase>;
const tableHash = (db: DB, t: string) => createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).digest('hex');
const listLines = () => { const f = join(DESK_DIR, 'for-a-person.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
function snapshot(db: DB) {
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
  return { maxHold: (db.prepare('SELECT coalesce(max(rowid),0) m FROM holds').get() as any).m, money: Object.fromEntries(['bookings', 'payouts', 'email_outbox'].map(t => [t, { n: count(t), hash: tableHash(db, t) }])), list: listLines().length };
}
type Turn = { guest: string; message: string; status: number; body: any };
type Check = { line: string; ok: boolean; detail: string };

function checkSaved(db: DB, text: string, before: ReturnType<typeof snapshot>, turns: Turn[], refRow: { row?: any }): Check[] {
  const after = snapshot(db), out: Check[] = [];
  for (const clause of text.split(';').map(s => s.trim()).filter(Boolean)) {
    let m: RegExpMatchArray | null, ok = false, detail = '';
    if ((m = clause.match(/^exactly one hold for (guest-\d+) on ([a-z0-9-]+) from (\S+) to (\S+), status (\w+)$/))) {
      const rows = db.prepare('SELECT h.* FROM holds h JOIN listings l ON l.id=h.listing_id WHERE h.guest_id=? AND l.slug=? AND h.from_date=? AND h.to_date=?').all(m[1], m[2], m[3], m[4]) as any[];
      refRow.row = rows[0]; ok = rows.length === 1 && rows[0].status === m[5];
      detail = `${rows.length} row(s)${rows[0] ? `, ${rows[0].reference} ${rows[0].status}` : ''}`;
    } else if ((m = clause.match(/^the reference in (?:both|every|all) repl(?:y|ies) is that row's reference$/))) {
      const ref = refRow.row?.reference;
      ok = !!ref && turns.every(t => String(t.body?.reply ?? '').toUpperCase().includes(ref));
      detail = ref ? turns.map(t => String(t.body?.reply ?? '').toUpperCase().includes(ref) ? 'has it' : 'missing').join(', ') : 'no saved row to compare';
    } else if ((m = clause.match(/^bookings, payouts and email_outbox have no new( or changed)? rows$/))) {
      const changed = Object.entries(after.money).filter(([t, v]) => m![1] ? v.hash !== (before.money as any)[t].hash : v.n !== (before.money as any)[t].n).map(([t]) => t);
      ok = changed.length === 0; detail = changed.length ? `changed: ${changed.join(', ')}` : 'unchanged';
    } else if ((m = clause.match(/^(RAP-[A-Z0-9]+) is unchanged \((.+)\)$/))) {
      const row = db.prepare('SELECT * FROM bookings WHERE reference=?').get(m[1]) as any;
      const want = Object.fromEntries(m[2].split(',').map(p => p.trim().split(/\s+/)).map(([k, v]) => [k, v]));
      const wrong = Object.entries(want).filter(([k, v]) => String(row?.[k]) !== v);
      ok = !!row && !wrong.length; detail = row ? (wrong.length ? wrong.map(([k]) => `${k}=${row[k]}`).join(', ') : 'as before') : 'no such reservation';
    } else if (/^no new hold$/.test(clause)) {
      ok = after.maxHold === before.maxHold; detail = ok ? 'none' : 'a hold was saved';
    } else if ((m = clause.match(/^no hold for (guest-\d+)$/))) {
      const n = (db.prepare('SELECT COUNT(*) n FROM holds WHERE guest_id=?').get(m[1]) as any).n; ok = n === 0; detail = `${n} hold(s)`;
    } else if ((m = clause.match(/^the run's own for-a-person list has exactly one new line, for (guest-\d+)(, quoting the message)?$/))) {
      const added = listLines().slice(before.list);
      const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
      ok = added.length === 1 && added[0].guestId === m[1] && (!m[2] || turns.some(t => flat(t.message).startsWith(flat(added[0].ask))));
      detail = `${added.length} new line(s)${added[0] ? `, ${added[0].guestId}, "${added[0].ask.slice(0, 60)}"` : ''}`;
    } else if (/^the response's confirmation is null$/.test(clause)) {
      ok = turns.every(t => t.status === 200 && t.body?.confirmation === null); detail = turns.map(t => `${t.status} ${t.body && 'confirmation' in t.body ? JSON.stringify(t.body.confirmation) : t.body?.error?.code}`).join(', ');
    } else {
      detail = 'the runner does not understand this clause';
    }
    out.push({ line: clause, ok, detail });
  }
  return out;
}

// ---------- the judge: Expect and Never from the replies, with a quote that must be in a reply ----------
const JUDGE = `You judge replies from a rental site's guest desk against written expectations. You see the visitor's messages, the desk's replies and facts the site returned.
For each numbered line: an "expect" line is met only if the replies clearly do what it says; a "never" line is violated only if a reply does what it forbids.
Give a short quote copied exactly from a reply as evidence (for a "never" line that is not violated, use an empty quote).
Answer with JSON only, no code fence: {"verdicts":[{"n":1,"met":true,"quote":"..."}]}. For a "never" line, "met" means it was violated.`;
function pi(system: string, prompt: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn('pi', ['-p', '--no-session', '-ne', '-ns', '-np', '-nc', '--no-mcp', '--no-tools', '--thinking', 'off', '--model', JUDGE_MODEL, '--system-prompt', system, prompt], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', code => code === 0 && out.trim() ? done(out.trim()) : fail(new Error(`judge failed: ${err.trim().slice(-200)}`)));
  });
}
async function judge(lines: any[], turns: Turn[], facts: string[]): Promise<Check[]> {
  const replies = turns.map(t => String(t.body?.reply ?? JSON.stringify(t.body)));
  const body = `${turns.map((t, i) => `Visitor (${t.guest}): ${t.message}\nDesk reply ${i + 1} (HTTP ${t.status}):\n"""\n${replies[i]}\n"""`).join('\n\n')}\n\nFacts the site returned:\n${facts.join('\n') || '(none)'}\n\nLines:\n${lines.map((l, i) => `${i + 1}. ${l.kind}: ${l.text}`).join('\n')}`;
  let last: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await pi(JUDGE, body);
      const verdicts = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).verdicts as { n: number; met: boolean; quote: string }[];
      return lines.map((l, i) => {
        const v = verdicts.find(x => x.n === i + 1);
        if (!v) return { line: `${l.kind}: ${l.text}`, ok: false, detail: 'no verdict' };
        const evidence = !!v.quote && replies.some(r => quoted(r, v.quote));
        const ok = l.kind === 'expect' ? v.met && evidence : !v.met;
        return { line: `${l.kind}: ${l.text}`, ok, detail: `${v.met ? (l.kind === 'never' ? 'violated' : 'met') : (l.kind === 'never' ? 'not violated' : 'not met')}${v.quote ? `, "${v.quote.slice(0, 80)}"${evidence ? '' : ' (quote not in any reply)'}` : ''}` };
      });
    } catch (e) { last = e as Error; }
  }
  return lines.map(l => ({ line: `${l.kind}: ${l.text}`, ok: false, detail: `judge did not answer: ${last?.message}` }));
}

// ---------- run ----------
type CaseResult = { title: string; run: number; ok: boolean; checks: Check[]; turns: Turn[] };
const results: CaseResult[] = [];
console.log(`Desk checks${opt.broken ? ` on a BROKEN desk (${opt.broken})` : ''}: ${cases.length} case(s) x ${REPEAT} run(s), judge ${JUDGE_MODEL}. Scratch folder ${work} (dev database untouched).`);
for (let run = 1; run <= REPEAT; run++) {
  if (run > 1) seed();
  const db = openDatabase(TEST_DB);
  const { server } = createApp(db);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const item of cases) {
      const env: Record<string, string> = {};
      for (const l of item.lines.filter((l: any) => l.kind === 'run')) {
        const m = l.text.match(/^([A-Z_][A-Z0-9_]*)=(\S+)/);
        if (m) env[m[1]] = m[2]; else execSync(l.text, { cwd: ROOT, env: process.env, stdio: 'ignore' });
      }
      const before = snapshot(db), turns: Turn[] = [];
      Object.assign(process.env, env);
      try {
        for (const d of steps(item)) {
          const who = d.pane.match(/^Visitor as (guest-\d+)$/i)?.[1];
          if (!who) throw new Error(`Line ${d.line}: Do lines here are "Do (Visitor as guest-N)".`);
          const res = await fetch(`${base}/desk`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `rap_session=${makeSession(who)}` }, body: JSON.stringify({ message: d.text }) });
          turns.push({ guest: who, message: d.text, status: res.status, body: await res.json() });
        }
      } finally { for (const k of Object.keys(env)) delete process.env[k]; }
      // Facts an Expect line names: the site's own quote for a stay, fetched from the same test server.
      const facts: string[] = [];
      for (const l of judged(item)) for (const m of l.text.matchAll(/GET \/api\/quote for ([a-z0-9-]+) (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d), (\d+) guests?/g)) {
        const q: any = await (await fetch(`${base}/api/quote?slug=${m[1]}&from=${m[2]}&to=${m[3]}&guests=${m[4]}`)).json();
        facts.push(`GET /api/quote for ${m[1]} ${m[2]} to ${m[3]}, ${m[4]} guests returned totalCents=${q.totalCents} ($${(q.totalCents / 100).toFixed(2)})`);
      }
      const refRow: { row?: any } = {};
      const checks = [...await judge(judged(item), turns, facts), ...saved(item).flatMap((l: any) => checkSaved(db, l.text, before, turns, refRow).map(c => ({ ...c, line: `saved: ${c.line}` })))];
      const ok = checks.every(c => c.ok);
      results.push({ title: item.title, run, ok, checks, turns });
      console.log(`run ${run}  ${ok ? 'PASS' : 'FAIL'}  ${item.title}${ok ? '' : '\n' + checks.filter(c => !c.ok).map(c => `      ${c.line}\n        -> ${c.detail}`).join('\n')}`);
    }
  } finally { server.close(); db.close(); }
}

console.log('');
for (const item of cases) { const rs = results.filter(r => r.title === item.title); console.log(`${rs.filter(r => r.ok).length}/${rs.length}  ${item.title}`); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(ROOT, 'agents/booking/reports'), { recursive: true });
const report = join(ROOT, `agents/booking/reports/desk-${opt.broken ? `broken-${opt.broken}-` : ''}${stamp}.md`);
writeFileSync(report, [`# Desk checks ${stamp}`, '', `${opt.broken ? `Broken desk: ${opt.broken}. ` : ''}${REPEAT} run(s) per case. Judge ${JUDGE_MODEL}. Test database in ${work}; dev database untouched.`, '',
  ...results.flatMap(r => [`## Run ${r.run} · ${r.ok ? 'PASS' : 'FAIL'} · ${r.title}`, '', ...r.turns.flatMap(t => [`Visitor (${t.guest}): ${t.message}`, '', '```', `HTTP ${t.status} ${JSON.stringify(t.body, null, 1)}`, '```', '']),
    ...r.checks.map(c => `- ${c.ok ? 'pass' : 'FAIL'} ${c.line}: ${c.detail}`), ''])].join('\n'));
console.log(`\nReport: ${report}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
