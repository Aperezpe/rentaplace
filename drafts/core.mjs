// Day 4, the two-step draft. Step one is this file: plain code that fetches the facts, chooses what the writer may see,
// and checks the writer's numbers. Step two is a model with no tools that only writes the words.

/** Only the "## Customer-facing" section of an agent's memories. The internal section is never handed to the writer. */
export function customerFacing(memories) {
  const lines = memories.split('\n');
  const start = lines.findIndex((l) => /^##\s+Customer-facing\s*$/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    // The source in brackets at the end of a memory (commits, tests, cards) is for engineers: drop it.
    if (line.startsWith('- ')) out.push(line.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '').trim());
  }
  return out;
}
export const dollars = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Turn the quote lookup into what the writer is told. `lookup` is { ok:true, quote } or { ok:false, reason }.
 * A failed lookup is said out loud as UNKNOWN; it is never dropped and never turned into "no" or "not available".
 * Returns the fact lines and the list of amounts (in cents) that code really looked up.
 */
export function facts(stay, lookup) {
  const head = `- stay asked about: ${stay.slug}, ${stay.from} to ${stay.to}, ${stay.guests} guests`;
  if (!lookup.ok) return { lines: [head, '- price: UNKNOWN. The price lookup failed just now. Do not state, estimate or hint at any amount.', '- dates: UNKNOWN. We could not check whether these dates are open.'], allowedCents: [] };
  const q = lookup.quote;
  const parts = [['total', q.totalCents], ['accommodation', q.accommodationCents], ['cleaning', q.cleaningCents], ['subtotal before fees and taxes', q.subtotalCents], ['service fee', q.serviceFeeCents], ['taxes', q.taxCents]].filter(([, c]) => Number.isInteger(c));
  const nightly = [...new Set((q.nightly ?? []).map((n) => n.cents))];
  return {
    lines: [head, '- dates: open (the quote succeeded, and a quote is only given for open dates)', ...parts.map(([name, c]) => `- ${name}: ${dollars(c)}`), ...(nightly.length ? [`- nightly rate(s): ${nightly.map(dollars).join(', ')}`] : []), `- nights: ${q.nights ?? (q.nightly ?? []).length}`],
    allowedCents: [...new Set([...parts.map(([, c]) => c), ...nightly])],
  };
}
/** Every money amount written in a text, in cents: $468, $468.00, $1,234.50, 468 dollars, USD 468. */
export function amountsIn(text) {
  const found = [];
  const re = /(?:\$|USD\s?)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:dollars|USD|bucks)\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2]).replace(/,/g, '').replace(/\.$/, '');
    found.push({ text: m[0].trim(), cents: Math.round(Number(raw) * 100) });
  }
  return found;
}
/** The number check: every amount in the draft must be one code looked up. Returns the amounts that are not. */
export function checkDraft(draft, allowedCents) {
  const notLookedUp = amountsIn(draft).filter((a) => !allowedCents.includes(a.cents));
  return { ok: notLookedUp.length === 0, notLookedUp };
}
export function writerPrompt({ question, factLines, notes }) {
  return {
    system: 'You are Booking, RentAPlace\'s reservation agent. Write a short, friendly reply to a guest, as a draft a person will review before it is sent. Use only the facts and notes you are given. You have no tools. If a fact is UNKNOWN, say plainly that we could not check it right now; never guess.',
    prompt: `Guest's message:\n${question}\n\nFacts fetched by code just now:\n${factLines.join('\n')}\n\nNotes you may rely on:\n${notes.map((n) => '- ' + n).join('\n')}\n\nWrite the reply.`,
  };
}
