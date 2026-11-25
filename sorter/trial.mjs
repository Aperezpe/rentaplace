// Sorter trial: keyword rules vs Claude Haiku vs Claude Sonnet vs Jev on an answer key.
// Haiku and Sonnet go through the Pi CLI with Abraham's existing sign-in (no API key).
// Jev goes to TypeSafe System One with TYPESAFE_API_KEY from .env (see sorter/jev.mjs).
// Run: node sorter/trial.mjs --runs 1 --label smoke [--set original|fresh]     (smoke test)
//      node sorter/trial.mjs --runs 15 --label full     (full trial)
// Writes sorter/trial-results/<label>-<time>.json (every call) and .md (report).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ANSWER_KEY } from './answer-key.mjs';
import { FRESH_SET } from './answer-key-fresh.mjs';
import { sortByKeywords } from './baseline.mjs';
import { JEV, callJev, parseJev, MONEY_P, SURE_P, SURE_OWNER } from './jev.mjs';

export const SETS = { original: ANSWER_KEY, fresh: FRESH_SET };
const setArg = process.argv.indexOf('--set');
export const SET = setArg > 0 ? process.argv[setArg + 1] : 'original';
if (!SETS[SET]) throw new Error(`Unknown --set ${SET}; use ${Object.keys(SETS).join(' or ')}`);
const KEY = SETS[SET];

export const OPTIONS = [
  { name: 'haiku', model: 'anthropic/claude-haiku-5-5' },
  { name: 'sonnet', model: 'anthropic/claude-sonnet-5-5' },
  { name: 'jev', model: JEV.model, via: 'typesafe' },
];
const THINKING = 'off';
const CONCURRENCY = Number(process.env.TRIAL_CONCURRENCY || 8);
const CALL_TIMEOUT_MS = 120_000;
const TRANSPORT_RETRIES = 2; // CLI or network failures only; a bad answer is never retried

export const SYSTEM = `You sort guest support tickets for RentAPlace, a vacation rental marketplace.
Return the owner and whether money is involved.

owner:
- "booking": reservations, dates, status (pending, confirmed, declined), check-in, arrival, cancellations.
- "pricing": prices, fees, charges, refunds, payments, deposits, payouts to hosts.
- "nobody": anything else.

money: true if the ticket is about money that was charged, paid, owed, refunded, paid out, or will change. Otherwise false.

Reply with strict JSON only, exactly {"owner":"booking"|"pricing"|"nobody","money":true|false}. No code fences, no other text.`;

const prompt = t => `Subject: ${t.subject}\nMessage: ${t.message}`;

/** Strict: the whole reply must be one JSON object with exactly owner (enum) and money (boolean). */
export function parseAnswer(text) {
  let value;
  try { value = JSON.parse(String(text ?? '').trim()); } catch { return { valid: false, reason: 'not JSON' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, reason: 'not an object' };
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'money,owner') return { valid: false, reason: `keys ${keys}` };
  if (!['booking', 'pricing', 'nobody'].includes(value.owner)) return { valid: false, reason: `owner ${JSON.stringify(value.owner)}` };
  if (typeof value.money !== 'boolean') return { valid: false, reason: `money ${JSON.stringify(value.money)}` };
  return { valid: true, owner: value.owner, money: value.money };
}

function callPi(model, ticket) {
  return new Promise(resolve => {
    const started = Date.now();
    const args = ['-p', '--mode', 'json', '--no-session', '--no-tools', '--no-extensions', '--no-context-files', '--no-skills', '--no-prompt-templates', '--thinking', THINKING, '--model', model, '--system-prompt', SYSTEM, prompt(ticket)];
    const child = spawn('pi', args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), CALL_TIMEOUT_MS);
    child.on('close', code => {
      clearTimeout(timer);
      let message = null;
      for (const line of out.split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.message?.role === 'assistant') message = e.message;
        if (Array.isArray(e.messages)) { const last = e.messages.filter(m => m.role === 'assistant').at(-1); if (last) message = last; }
      }
      const text = message ? message.content.filter(c => c.type === 'text').map(c => c.text).join('') : null;
      const failed = !message || message.stopReason === 'error' || code !== 0;
      resolve({ ok: !failed, text, modelReported: message?.model ?? null, provider: message?.provider ?? null, responseId: message?.responseId ?? null, stopReason: message?.stopReason ?? null, usage: message?.usage ? { input: (message.usage.input || 0) + (message.usage.cacheRead || 0) + (message.usage.cacheWrite || 0), uncachedInput: message.usage.input, cacheRead: message.usage.cacheRead, cacheWrite: message.usage.cacheWrite, output: message.usage.output, costUsd: message.usage.cost?.total } : null, error: failed ? (message?.errorMessage || err.trim().slice(-500) || `exit ${code}`) : null, ms: Date.now() - started });
    });
  });
}

async function runCall(option, ticket, run) {
  if (option.via === 'typesafe') {
    const r = await callJev(ticket);
    const parsed = r.ok ? parseJev(r.raw) : { valid: false, reason: `call failed: ${r.status} ${r.error}` };
    return score(ticket, { option: option.name, modelRequested: option.model, run, attempts: r.attempts, ok: r.ok, status: r.status, modelReported: r.modelReported ?? null, raw: r.raw ?? null, usage: r.usage ? { input: r.usage.input_tokens, output: r.usage.output_tokens, costUsd: r.costUsd } : null, error: r.ok ? null : r.error, ms: r.ms, answer: parsed });
  }
  let result, attempts = 0;
  do { attempts++; result = await callPi(option.model, ticket); } while (!result.ok && attempts <= TRANSPORT_RETRIES);
  const parsed = result.ok ? parseAnswer(result.text) : { valid: false, reason: `call failed: ${result.error}` };
  return score(ticket, { option: option.name, modelRequested: option.model, thinking: THINKING, run, attempts, ...result, answer: parsed });
}

/** flagged = said money. safe = flagged, or (Jev only) unsure, so a person looks at it. Invalid is never safe. */
function score(ticket, row) {
  const owners = [ticket.owner].flat();
  const a = row.answer;
  const flagged = a.valid && a.money === true;
  return { ticket: ticket.id, kind: ticket.kind, key: { owner: owners, money: ticket.money }, ...row, ownerOk: a.valid && owners.includes(a.owner), moneyOk: a.valid && a.money === ticket.money, flagged, unsure: a.valid && a.unsure === true, safe: flagged || (a.valid && a.unsure === true) };
}

async function pool(jobs, size, onDone) {
  const results = []; let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); onDone(++done, jobs.length); }
  }));
  return results;
}

const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export function summarize(rows, name, runs) {
  const mine = rows.filter(r => r.option === name);
  const moneyTickets = KEY.filter(t => t.money);
  const safeRuns = id => mine.filter(r => r.ticket === id && r.safe).length;
  const ms = mine.map(r => r.ms).filter(x => typeof x === 'number');
  return {
    option: name,
    model: [...new Set(mine.map(r => r.modelReported || r.modelRequested))].join(', '),
    calls: mine.length,
    invalid: mine.filter(r => !r.answer.valid).length,
    ownerAccuracy: mine.filter(r => r.ownerOk).length / mine.length,
    moneyAccuracy: mine.filter(r => r.moneyOk).length / mine.length,
    unsure: mine.filter(r => r.unsure).length,
    pass: moneyTickets.every(t => safeRuns(t.id) === runs),
    neverSafe: moneyTickets.filter(t => safeRuns(t.id) === 0).map(t => t.id),
    sometimesMissed: moneyTickets.filter(t => safeRuns(t.id) > 0 && safeRuns(t.id) < runs).map(t => `${t.id} (${runs - safeRuns(t.id)}/${runs})`),
    latencyMs: ms.length ? { median: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: Math.max(...ms) } : null,
    inputTokens: mine.reduce((s, r) => s + (r.usage?.input || 0), 0),
    outputTokens: mine.reduce((s, r) => s + (r.usage?.output || 0), 0),
    costUsd: mine.reduce((s, r) => s + (r.usage?.costUsd || 0), 0),
  };
}

const pct = x => `${(x * 100).toFixed(1)}%`;

export function report(rows, runs, label) {
  const keywordRuns = 1;
  const sums = [summarize(rows, 'keywords', keywordRuns), ...OPTIONS.map(o => summarize(rows, o.name, runs))];
  const names = sums.map(s => s.option);
  const runsOf = n => (n === 'keywords' ? keywordRuns : runs);
  const lines = [`# Sorter trial: ${label}`, '', `Set: ${SET}. ${KEY.length} tickets. Keyword rules: 1 run (deterministic). Models: ${runs} run(s) per ticket. Haiku and Sonnet: thinking ${THINKING}, via Pi CLI. Jev: TypeSafe System One.`, '',
    'Pass = every money ticket safe in every run. Safe = flagged money; for Jev also unsure. Invalid or missing answers count as misses.', '',
    `Jev rule (in code): money = moneyP >= ${MONEY_P}; unsure if ${MONEY_P} <= moneyP < ${SURE_P} or owner confidence < ${SURE_OWNER}.`, '',
    '| Option | Model | Owner accuracy | Money accuracy | Unsure runs | Invalid | Pass |', '|---|---|---|---|---|---|---|',
    ...sums.map(s => `| ${s.option} | ${s.model} | ${pct(s.ownerAccuracy)} | ${pct(s.moneyAccuracy)} | ${s.option === 'jev' ? `${s.unsure}/${s.calls}` : 'n/a'} | ${s.invalid}/${s.calls} | ${s.pass ? 'PASS' : '**FAIL**'} |`), '',
    '## Latency and cost', '', '| Option | Median ms | p95 ms | Max ms | Input tokens | Output tokens | Cost USD |', '|---|---|---|---|---|---|---|',
    ...sums.filter(s => s.option !== 'keywords').map(s => `| ${s.option} | ${s.latencyMs?.median ?? ''} | ${s.latencyMs?.p95 ?? ''} | ${s.latencyMs?.max ?? ''} | ${s.inputTokens} | ${s.outputTokens} | $${s.costUsd.toFixed(4)} |`), '',
    'Haiku and Sonnet latency is one Pi CLI process per call, so it includes start-up time. Their cost is what Pi estimates at API prices; the calls run on the Pi sign-in. Jev cost is input tokens at $42 per billion (output is free).', ''];

  const never = sums.filter(s => s.neverSafe.length);
  lines.push('## Money tickets never flagged in any run', '', 'For Jev, a run that was unsure counts as caught.', '');
  if (never.length) for (const s of never) lines.push(`- **${s.option}: ${s.neverSafe.map(id => `${id} (${KEY.find(t => t.id === id).kind})`).join(', ')}**`);
  else lines.push('None.');
  const some = sums.filter(s => s.sometimesMissed.length);
  if (some.length) { lines.push('', 'Money tickets missed in some runs:'); for (const s of some) lines.push(`- ${s.option}: ${s.sometimesMissed.join(', ')}`); }

  lines.push('', '## Misses per ticket', '', 'Each cell: owner misses / money misses out of that option\'s runs, then the most common wrong answer. Blank = no misses.', '',
    `| Ticket | Kind | Key | ${names.join(' | ')} |`, `|---|---|---|${names.map(() => '---').join('|')}|`);
  for (const t of KEY) {
    const cells = names.map(n => {
      const r = rows.filter(x => x.option === n && x.ticket === t.id), N = runsOf(n);
      const om = r.filter(x => !x.ownerOk).length, mm = r.filter(x => !x.moneyOk).length;
      if (!om && !mm) return '';
      const wrong = r.filter(x => !x.ownerOk || !x.moneyOk).map(x => x.answer.valid ? `${x.answer.owner}/${x.answer.money}` : 'invalid');
      const top = Object.entries(wrong.reduce((m, w) => ({ ...m, [w]: (m[w] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
      const neverFlag = t.money && r.every(x => !x.safe) ? ' **NEVER FLAGGED**' : '';
      return `owner ${om}/${N}, money ${mm}/${N}; said ${top[0]}${neverFlag}`;
    });
    if (cells.some(Boolean)) lines.push(`| ${t.id} | ${t.kind} | ${[t.owner].flat().join('\\|')}/${t.money} | ${cells.join(' | ')} |`);
  }

  lines.push('', '## Jev per ticket', '', '| Ticket | Kind | Key | moneyP range | Owner confidence range | Unsure runs | Money flagged runs | Caught (flagged or unsure) |', '|---|---|---|---|---|---|---|---|');
  const range = xs => xs.length ? (Math.min(...xs) === Math.max(...xs) ? Math.min(...xs).toFixed(2) : `${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}`) : 'n/a';
  for (const t of KEY) {
    const r = rows.filter(x => x.option === 'jev' && x.ticket === t.id), v = r.filter(x => x.answer.valid);
    lines.push(`| ${t.id} | ${t.kind} | ${[t.owner].flat().join('\\|')}/${t.money} | ${range(v.map(x => x.answer.moneyP))} | ${range(v.map(x => x.answer.ownerConfidence))} | ${r.filter(x => x.unsure).length}/${runs} | ${r.filter(x => x.flagged).length}/${runs} | ${t.money ? `${r.filter(x => x.safe).length}/${runs}` : 'n/a'} |`);
  }
  return { markdown: lines.join('\n') + '\n', summaries: sums };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const runs = Number(arg('runs', 1)), label = arg('label', runs === 1 ? 'smoke' : `runs${runs}`);
  const only = arg('only', null);
  const options = only ? OPTIONS.filter(o => only.split(',').includes(o.name)) : OPTIONS;
  const started = new Date();
  const keywordRows = KEY.map(t => { const k = sortByKeywords(t); return score(t, { option: 'keywords', modelRequested: 'keyword rules (sorter/baseline.mjs)', modelReported: 'keyword rules', run: 1, answer: { valid: true, owner: k.owner, money: k.money } }); });
  const jobs = options.flatMap(o => KEY.flatMap(t => Array.from({ length: runs }, (_, i) => () => runCall(o, t, i + 1))));
  process.stderr.write(`${jobs.length} model calls, ${CONCURRENCY} at a time\n`);
  const modelRows = await pool(jobs, CONCURRENCY, (d, n) => { if (d % 20 === 0 || d === n) process.stderr.write(`  ${d}/${n}\n`); });
  const rows = [...keywordRows, ...modelRows];
  const { markdown, summaries } = report(rows, runs, label);
  const dir = new URL('./trial-results/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, '-');
  const base = new URL(`${label}-${stamp}`, dir).pathname;
  const cost = modelRows.reduce((s, r) => s + (r.usage?.costUsd || 0), 0);
  writeFileSync(`${base}.json`, JSON.stringify({ label, set: SET, runs, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), thinking: THINKING, options, system: SYSTEM, jevQuestions: (await import('./jev.mjs')).QUESTIONS, jevRule: { MONEY_P, SURE_P, SURE_OWNER }, estimatedCostUsd: cost, summaries, rows }, null, 2) + '\n');
  writeFileSync(`${base}.md`, markdown);
  console.log(markdown);
  console.log(`Saved ${base}.json and .md (estimated cost $${cost.toFixed(4)})`);
}
