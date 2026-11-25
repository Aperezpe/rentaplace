// Keyword-rules baseline for the support sorter. No model calls.
// Run: node sorter/baseline.mjs   Writes sorter/baseline-results.json.
import { writeFileSync } from 'node:fs';
import { ANSWER_KEY } from './answer-key.mjs';

export const MONEY_WORDS = ['refund', 'charge', 'fee', 'price', 'payout', 'deposit', 'total', 'pay', 'paid', 'cost', 'free'];
export const BOOKING_WORDS = ['dates', 'pending', 'confirmed', 'check-in', 'arrive', 'cancel', 'reservation', 'declined'];
export const PRICING_WORDS = ['refund', 'charge', 'fee', 'price', 'rate', 'payout', 'deposit', 'cost', 'total', 'discount', 'tax'];

// Whole words, with plain endings: "cancel" matches "cancelled", "fee" matches "fees", "pay" does not match "payout".
const pattern = words => new RegExp(`\\b(?:${words.map(w => w.replace(/[-]/g, '[- ]?')).join('|')})(?:s|es|d|ed|led|ing)?\\b`, 'gi');
const hits = (text, words) => [...new Set((text.match(pattern(words)) || []).map(w => w.toLowerCase().replace(' ', '-')))];

/** Pricing words win over booking words: a booking question that is about money goes to pricing. */
export function sortByKeywords({ subject, message }) {
  const text = `${subject}\n${message}`;
  const money = hits(text, MONEY_WORDS), pricing = hits(text, PRICING_WORDS), booking = hits(text, BOOKING_WORDS);
  const owner = pricing.length ? 'pricing' : booking.length ? 'booking' : 'nobody';
  return { owner, money: money.length > 0, matched: { money, pricing, booking } };
}

const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;

export function evaluate(key = ANSWER_KEY) {
  const rows = key.map(t => {
    const got = sortByKeywords(t);
    const owners = [t.owner].flat();
    return { id: t.id, kind: t.kind, subject: t.subject, got: { owner: got.owner, money: got.money }, key: { owner: owners, money: t.money }, matched: got.matched, ownerOk: owners.includes(got.owner), moneyOk: got.money === t.money };
  });
  const ownerOk = rows.filter(r => r.ownerOk).length, moneyOk = rows.filter(r => r.moneyOk).length;
  return { total: rows.length, ownerAccuracy: ownerOk / rows.length, moneyAccuracy: moneyOk / rows.length, ownerCorrect: ownerOk, moneyCorrect: moneyOk, misses: rows.filter(r => !r.ownerOk || !r.moneyOk), rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = evaluate();
  const out = new URL('./baseline-results.json', import.meta.url);
  writeFileSync(out, JSON.stringify({ rules: { MONEY_WORDS, BOOKING_WORDS, PRICING_WORDS, precedence: 'pricing > booking > nobody' }, ...result }, null, 2) + '\n');
  console.log(`Owner accuracy: ${pct(result.ownerCorrect, result.total)}`);
  console.log(`Money accuracy: ${pct(result.moneyCorrect, result.total)}`);
  console.log(`\nMisses (${result.misses.length}):`);
  for (const r of result.misses) {
    const parts = [];
    if (!r.ownerOk) parts.push(`owner ${r.got.owner} vs key ${r.key.owner.join('|')}`);
    if (!r.moneyOk) parts.push(`money ${r.got.money} vs key ${r.key.money}`);
    const words = Object.values(r.matched).flat();
    console.log(`  ${r.id} ${r.kind}: ${parts.join('; ')}${words.length ? `  [matched: ${[...new Set(words)].join(', ')}]` : ''}`);
  }
  console.log(`\nSaved ${out.pathname}`);
}
