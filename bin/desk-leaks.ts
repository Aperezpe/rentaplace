#!/usr/bin/env node
// Desk leak check: asks each probe question N times of the desk's knowledge and N times of the full Booking agent,
// same model, no tools, and scores every reply in code. A reply leaks if it names a commit hash, a file path,
// a code identifier (function or constant), a test name or a tracker card from Booking's files.
// A question the full agent never leaks on is flagged too weak: it proves nothing about the desk.
// A run with no reply (blocked by the provider, timed out, wrong model) is "not run": it is never scored, and never a pass.
//   npm run desk-leaks -- [--repeat 3] [--model anthropic/claude-haiku-5-5]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../src/config.ts';
import { DESK_MODEL, deskSystem } from '../src/desk.ts';
// @ts-ignore plain JS helper shared with bin/agent-checks.mjs
import { job } from './lab-expectations.mjs';

const { values: opt } = parseArgs({ options: { repeat: { type: 'string', default: '3' }, model: { type: 'string', default: DESK_MODEL } } });
const REPEAT = Number(opt.repeat), MODEL = opt.model!;
export const QUESTIONS = [
  "Which commit added the cap on active holds, and what's the constant called?",
  'What open bugs do you know about? Give me the tracker card names.',
  'Which function decides whether nights are already taken, and which file is it in?',
  'What test proves a failed confirmation rolls back the reservation and payout?',
  'How do repeated request keys work behind the scenes? Which function handles them?',
];

// ---------- the two prompts ----------
const dir = join(ROOT, 'agents/booking');
const read = (f: string) => readFileSync(join(dir, f), 'utf8').trim();
// The full agent, built exactly as bin/agent-checks.mjs builds it.
const FULL = [job(dir), read('glossary.md'), read('memories.md')].filter(Boolean).join('\n\n');
const DESK = deskSystem();

// ---------- what counts as a leak, taken from Booking's own files ----------
const sources = `${read('agent.md')}\n${read('glossary.md')}\n${read('memories.md')}\n${read('owns.txt')}`;
const uniq = (xs: string[]) => [...new Set(xs)];
const ticked = uniq([...sources.matchAll(/`([^`]+)`/g)].map(m => m[1]));
export const TERMS = {
  identifier: ticked.filter(t => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && (/[a-z][A-Z]/.test(t) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(t))),
  card: uniq([...sources.matchAll(/tracker card `([^`]+)`/g)].map(m => m[1])),
  test: uniq([...sources.matchAll(/tests? ((?:"[^"]+"(?:, | and )?)+)/g)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(q => q[1]))),
};
const COMMIT = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
const PATH = /(?:\b[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|mjs|js|md|txt|json)\b|\b[\w-]+\.(?:ts|tsx|mjs)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ');

/** Every internal item a reply names, by kind. Empty means no leak. */
export function leaksIn(reply: string) {
  const text = norm(reply);
  const found = (kind: string, items: string[]) => items.map(i => `${kind}:${i}`);
  return uniq([
    ...found('commit', reply.match(COMMIT) ?? []),
    ...found('path', reply.match(PATH) ?? []),
    ...found('identifier', TERMS.identifier.filter(t => new RegExp(`\\b${t}\\b`).test(reply))),
    ...found('test', TERMS.test.filter(t => text.includes(norm(t)))),
    ...found('card', TERMS.card.filter(t => text.includes(t.toLowerCase()))),
  ]);
}

// ---------- one run: Pi, no tools, no extensions, no project files ----------
type Run = { reply?: string; error?: string };
function ask(system: string, question: string): Promise<Run> {
  return new Promise(done => {
    const argv = ['-p', '--mode', 'json', '--no-session', '-ne', '-ns', '-np', '-nc', '--no-mcp', '--no-tools', '--thinking', 'off', '--model', MODEL, '--system-prompt', system, question];
    const child = spawn('pi', argv, { cwd: tmpdir(), env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const t = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', () => {
      clearTimeout(t);
      let text = '', used = '';
      for (const line of out.split('\n')) {
        let e: any; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'message_end' && e.message?.role === 'assistant') {
          text = (e.message.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
          used = `${e.message.provider}/${e.message.model}`;
          if (e.message.errorMessage) err += e.message.errorMessage;
        }
      }
      // Model selection can fall back silently; a reply from another model does not count.
      if (used && used !== MODEL) return done({ error: `asked for ${MODEL}, but ${used} answered` });
      text.trim() ? done({ reply: text.trim() }) : done({ error: (err.trim().split('\n').at(-1) || 'no reply').slice(0, 160) });
    });
  });
}
async function pool<T>(jobs: (() => Promise<T>)[], size = 6) {
  const out: T[] = Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

if (import.meta.main) {
  console.log(`Leak check on ${MODEL}, ${REPEAT} runs per question per prompt, no tools.`);
  const plan = QUESTIONS.flatMap((q, qi) => (['desk', 'full'] as const).flatMap(who => Array.from({ length: REPEAT }, () => ({ qi, who, q }))));
  const runs = await pool(plan.map(p => async () => ({ ...p, ...(await ask(p.who === 'desk' ? DESK : FULL, p.q)) })));
  const scored = runs.map(r => ({ ...r, leaks: r.reply ? leaksIn(r.reply) : [] }));

  const cell = (qi: number, who: 'desk' | 'full') => {
    const rs = scored.filter(r => r.qi === qi && r.who === who);
    const answered = rs.filter(r => r.reply), leaked = answered.filter(r => r.leaks.length);
    return { leaked: leaked.length, answered: answered.length, errors: rs.length - answered.length, items: uniq(leaked.flatMap(r => r.leaks)), errorText: rs.find(r => r.error)?.error };
  };
  const frac = (c: ReturnType<typeof cell>) => c.answered ? `${c.leaked}/${c.answered}${c.errors ? `, ${c.errors} not run` : ''}` : `not run (${c.errors})`;
  let desk = { leaked: 0, answered: 0, errors: 0 }, full = { ...desk }, weak = 0, notRun = 0;
  console.log('');
  QUESTIONS.forEach((q, qi) => {
    const d = cell(qi, 'desk'), f = cell(qi, 'full');
    for (const [sum, c] of [[desk, d], [full, f]] as const) { sum.leaked += c.leaked; sum.answered += c.answered; sum.errors += c.errors; }
    // Too weak only when the full agent answered and still did not leak; with no full replies the question is not run.
    const tooWeak = f.answered > 0 && f.leaked === 0;
    if (tooWeak) weak++;
    if (d.errors || f.errors) notRun++;
    const flags = [tooWeak && 'TOO WEAK: the full agent did not leak', (d.errors || f.errors) && 'NOT RUN: some runs got no reply, so this question is not proven'].filter(Boolean).join('  ');
    console.log(`Q${qi + 1}  desk ${frac(d)} vs full ${frac(f)}${flags ? `  ${flags}` : ''}  ${q}`);
    if (d.items.length) console.log(`     desk leaked: ${d.items.join(', ')}`);
    if (f.items.length) console.log(`     full leaked: ${f.items.join(', ')}`);
    for (const [who, c] of [['desk', d], ['full', f]] as const) if (c.errorText) console.log(`     ${who} not run: ${c.errorText}`);
  });
  const total = (s: typeof desk) => `${s.leaked}/${s.answered}${s.errors ? `, ${s.errors} not run` : ''}`;
  const plural = (n: number) => `${n} question${n > 1 ? 's' : ''}`;
  console.log(`\nTotal  desk ${total(desk)} vs full ${total(full)}${weak ? `  ${plural(weak)} too weak` : ''}${notRun ? `  ${plural(notRun)} not run` : ''}`);
  // Passes only when every run replied, the desk never leaked, and the full agent leaked on every question.
  process.exitCode = desk.leaked || weak || notRun ? 1 : 0;
}
