#!/usr/bin/env node
// The same labelled set, sorted by Jev (TypeSafe): two typed questions per ticket, no text to parse.
//   node sorter/jev-trial.mjs <outFolder> [k=15]
// Key: TYPESAFE_API_KEY, or the line in ~/dev/jev-demos/.env. Never printed. No retries: a failed call is counted as invalid.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TICKETS } from './labelled.mjs';
import { OWNERS, ticketText, grade } from './core.mjs';

const MODEL = 'jev-1.13.0';
const key = process.env.TYPESAFE_API_KEY || readFileSync(`${process.env.HOME}/dev/jev-demos/.env`, 'utf8').match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) { console.error('no TYPESAFE_API_KEY'); process.exit(2); }

// The sorter's instruction (core.mjs INSTRUCTION), said as a menu instead of a paragraph. Same definitions, same words.
const OWNER_CRITERIA = {
  booking: 'The reservation itself: dates, status (pending, confirmed), the confirmation, arrival, the host accepting or declining, checkout as an action.',
  pricing: 'What a guest pays, what is refunded, what a host receives: prices, fees, tax, refunds, payouts.',
  nobody: 'Neither of those (site speed, amenities, listing settings, safety, anything else). Choose this rather than stretch a team to fit.',
};
export const questions = (order = OWNERS) => ({
  owner: { type: 'choice', instructions: 'This is one support ticket for RentAPlace, a vacation-rental site. Who looks at it first?', criteria: Object.fromEntries(order.map((o) => [o, OWNER_CRITERIA[o]])) },
  money: { type: 'noul', instructions: 'Is this ticket about money moving or owed: a refund, a charge, a payout, a price or total, compensation, a deposit? A ticket that only contains a money-sounding word is not.' },
});
const unit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
/** Jev's answers → { owner, money, ownerConfidence, moneyP }, or null when anything is missing or malformed. */
export function readAnswers(a) {
  const o = a?.owner, m = a?.money;
  if (o?.type !== 'choice' || !OWNERS.includes(o.choice) || !unit(o.confidence) || !OWNERS.every((x) => unit(o.probabilities?.[x]))) return null;
  if (m?.type !== 'noul' || !unit(m.noul)) return null;
  return { owner: o.choice, money: m.noul >= 0.5, ownerConfidence: o.confidence, ownerP: o.probabilities, moneyP: m.noul };
}
export async function ask(t, order) {
  const started = performance.now();
  const res = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, state: ticketText(t), questions: questions(order) }) });
  const ms = Math.round(performance.now() - started);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return { ms, model: j.model, tokens: j.usage?.input_tokens ?? 0, got: readAnswers(j.answers) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(process.argv[2]); const k = Number(process.argv[3] || 15); mkdirSync(out, { recursive: true });
  const shuffles = [['booking', 'pricing', 'nobody'], ['nobody', 'booking', 'pricing'], ['pricing', 'nobody', 'booking']];
  const jobs = []; for (let run = 1; run <= k; run++) for (const t of TICKETS) jobs.push({ run, t, order: shuffles[run % 3] });
  const rows = []; let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) { const j = jobs[next++]; let r = { got: null }, error = null; try { r = await ask(j.t, j.order); } catch (e) { error = String(e.message ?? e).replaceAll(key, '[key]').slice(0, 120); } rows.push({ run: j.run, id: j.t.id, order: j.order.join('>'), error, ...r, ...grade(j.t, r.got) }); } }));
  const runs = Array.from({ length: k }, (_, i) => rows.filter((r) => r.run === i + 1));
  const ms = rows.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b), tokens = rows.reduce((n, r) => n + (r.tokens || 0), 0);
  const perTicket = TICKETS.map((t) => { const rs = rows.filter((r) => r.id === t.id && r.got); const span = (f) => [Math.min(...rs.map(f)), Math.max(...rs.map(f))].map((n) => +n.toFixed(3)); return { id: t.id, subject: t.subject, label: { owner: t.owner, money: t.money }, owners: [...new Set(rs.map((r) => r.got.owner))], ownerRight: rs.filter((r) => r.owner).length, moneyRight: rs.filter((r) => r.money).length, of: k, ownerConfidence: span((r) => r.got.ownerConfidence), moneyP: span((r) => r.got.moneyP) }; });
  const summary = { model: [...new Set(rows.map((r) => r.model).filter(Boolean))], tickets: TICKETS.length, k, calls: rows.length, invalid: rows.filter((r) => !r.valid).length, errors: [...new Set(rows.map((r) => r.error).filter(Boolean))],
    moneyRightPerRun: runs.map((rs) => rs.filter((r) => r.money).length), ownerRightPerRun: runs.map((rs) => rs.filter((r) => r.owner).length), runsWithEveryMoneyRight: runs.filter((rs) => rs.every((r) => r.money)).length, runsWithEverythingRight: runs.filter((rs) => rs.every((r) => r.money && r.owner)).length,
    ms: { median: ms[ms.length >> 1], p90: ms[Math.floor(ms.length * 0.9)], max: ms.at(-1) }, inputTokens: tokens, usd: +(tokens * 0.042 / 1e6).toFixed(6) };
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ summary, perTicket, rows }, null, 1));
  console.log(JSON.stringify({ summary, perTicket }, null, 1));
}
