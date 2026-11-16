// Jev (TypeSafe's typed-question model) as a sorter: two typed questions per ticket, answers come back as a label and
// probabilities, never text. This file is the one home for the questions, the check on the answers, and the rule that
// decides when a ticket waits for a person. The key is read from TYPESAFE_API_KEY or ~/dev/jev-demos/.env and is never printed.
import { readFileSync } from 'node:fs';
import { OWNERS, ticketText } from './core.mjs';

export const MODEL = 'jev-1.13.0'; // pinned: the version the trials ran on

// ── The rule: when is Jev unsure? ────────────────────────────────────────────────────────────────────────────────
// How the bars were chosen: from runs/jev/trial-1 only (the first 16 labelled tickets, 15 runs each), before the fresh
// set (labelled-fresh.mjs) was ever run. In that trial every not-money ticket had a money probability of 0.19 or less,
// every money ticket but one had 0.80 or more, and the one Jev kept missing (the double charge, new-1) had 0.42–0.53.
// Owner confidence on the tickets Jev got wrong or that sit on a border was 0.22–0.67.
// They are product choices, not facts about the model. Do not move them to fit a set they are being tested on.
/** Money probability at or above this counts as money (a half-sure "maybe money" is treated as money). */
export const MONEY_AT = 0.30;
/** Money probability at or above this is money without doubt. From MONEY_AT up to here is the unsure band. */
export const MONEY_SURE = 0.70;
/** Owner confidence under this is unsure. */
export const OWNER_SURE = 0.70;

/**
 * Checked answers → what the sorter writes: { owner, money, unsure, why, moneyP, ownerConfidence }, or null when there
 * are no checked answers (null means no tag). `unsure: true` means the ticket waits for a person, with the reason in `why`.
 */
export function decide(got) {
  if (!got) return null;
  const why = [];
  if (got.moneyP >= MONEY_AT && got.moneyP < MONEY_SURE) why.push(`money probability ${got.moneyP.toFixed(2)} is between ${MONEY_AT.toFixed(2)} and ${MONEY_SURE.toFixed(2)}`);
  if (got.ownerConfidence < OWNER_SURE) why.push(`owner confidence ${got.ownerConfidence.toFixed(2)} is under ${OWNER_SURE.toFixed(2)}`);
  return { owner: got.owner, money: got.moneyP >= MONEY_AT, unsure: why.length > 0, why, moneyP: got.moneyP, ownerConfidence: got.ownerConfidence };
}

// ── The questions: the sorter's instruction (core.mjs INSTRUCTION), said as a menu. Same definitions, same words. ──
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
/** Jev's answers → { owner, ownerConfidence, ownerP, moneyP }, or null when anything is missing, extra or malformed. Never defaulted. */
export function readAnswers(a) {
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== 'money,owner') return null;
  const o = a.owner, m = a.money;
  if (o?.type !== 'choice' || !OWNERS.includes(o.choice) || !unit(o.confidence) || !o.probabilities || Object.keys(o.probabilities).sort().join() !== [...OWNERS].sort().join() || !OWNERS.every((x) => unit(o.probabilities[x]))) return null;
  if (m?.type !== 'noul' || !unit(m.noul)) return null;
  return { owner: o.choice, ownerConfidence: o.confidence, ownerP: o.probabilities, moneyP: m.noul };
}

let cachedKey;
function key() {
  if (cachedKey) return cachedKey;
  let k = process.env.TYPESAFE_API_KEY;
  if (!k) { try { k = readFileSync(`${process.env.HOME}/dev/jev-demos/.env`, 'utf8').match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ''); } catch {} }
  if (!k) throw new Error('no TYPESAFE_API_KEY');
  return (cachedKey = k);
}
/** One request, no retries. Throws when Jev cannot be reached or refuses; `got` is null when the answers fail the check. */
export async function ask(t, order) {
  const k = key();
  const started = performance.now();
  let res;
  try { res = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, state: ticketText(t), questions: questions(order) }) }); }
  catch (e) { throw new Error(`Jev did not answer: ${String(e.message ?? e).replaceAll(k, '[key]').slice(0, 120)}`); }
  const ms = Math.round(performance.now() - started);
  if (!res.ok) throw new Error(`Jev answered HTTP ${res.status}`);
  const j = await res.json();
  // A different model than the pinned one answering is treated as no answer.
  return { ms, model: j.model, tokens: j.usage?.input_tokens ?? 0, got: j.model === MODEL ? readAnswers(j.answers) : null };
}
