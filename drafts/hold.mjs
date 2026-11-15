// Day 4, the held-stay draft. A guest asks about a hold they placed: until when is it held, and at what price?
// Both answers are on the hold row. Plain code looks them up; the writer is handed them; code checks the draft.
// The lookup reads the product's database read-only: the hold API is for the guest's own sign-in, and a draft tool has none.
import { DatabaseSync } from 'node:sqlite';
import { dollars, checkDraft } from './core.mjs';

/** The one hold reference in a ticket ("HOLD-1A2B3C4D"), or null when there is none or more than one. */
export function holdRefIn(text) {
  const refs = [...new Set((text.match(/\bHOLD-[0-9A-F]{8}\b/gi) ?? []).map((r) => r.toUpperCase()))];
  return refs.length === 1 ? refs[0] : null;
}
/** "2026-11-10T12:00:00.000Z" → "10 November 2026, 12:00 UTC". Code writes the time once; the writer copies it. */
export function untilText(iso) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
/**
 * Look the hold up. Returns { ok:true, hold } or { ok:false, reason }. Whether it is still active is decided here from
 * the clock passed in, the way the product does it (expires_at > clock); nothing is assumed about a background job.
 */
export function lookUpHold(dbFile, reference, clock) {
  let db;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const row = db.prepare('SELECT h.reference,h.from_date,h.to_date,h.guests,h.status,h.quote,h.total_cents,h.expires_at,h.guest_id,l.slug,l.title FROM holds h JOIN listings l ON h.listing_id=l.id WHERE h.reference=?').get(reference);
    if (!row) return { ok: false, reason: 'no hold with that reference' };
    const status = row.status === 'active' && row.expires_at <= clock ? 'expired' : row.status;
    return { ok: true, hold: { reference: row.reference, slug: row.slug, title: row.title, from: row.from_date, to: row.to_date, guests: row.guests, status, expiresAt: row.expires_at, totalCents: row.total_cents, quote: JSON.parse(row.quote), guestId: row.guest_id } };
  } catch (e) { return { ok: false, reason: String(e.code ?? e.message ?? e).slice(0, 80) }; }
  finally { try { db?.close(); } catch {} }
}
/** What the writer is told about the hold, the amounts code looked up, and the one time it may state. */
export function holdFacts(reference, lookup) {
  const head = `- hold asked about: ${reference}`;
  if (!lookup.ok) return { lines: [head, '- hold: UNKNOWN. The hold lookup failed just now. Do not state, estimate or hint at when it runs out, how long it lasts, or any amount.'], allowedCents: [], until: null };
  const h = lookup.hold, q = h.quote;
  const stay = `- held stay: ${h.title}, ${h.from} to ${h.to}, ${h.guests} guests`;
  if (h.status !== 'active') return { lines: [head, stay, `- hold status: ${h.status === 'expired' ? `it ran out on ${untilText(h.expiresAt)}` : h.status === 'converted' ? 'it became a reservation' : 'the guest released it'}. It keeps no nights and no price now.`, '- price: UNKNOWN. No price is held any more, and none was looked up. Do not state, estimate or hint at any amount.'], allowedCents: [], until: h.status === 'expired' ? untilText(h.expiresAt) : null };
  const parts = [['held total', h.totalCents], ['accommodation', q.accommodationCents], ['cleaning', q.cleaningCents], ['service fee', q.serviceFeeCents], ['taxes', q.taxCents]].filter(([, c]) => Number.isInteger(c));
  return { lines: [head, stay, '- hold status: active', `- held until: ${untilText(h.expiresAt)} (state this time exactly as written)`, ...parts.map(([name, c]) => `- ${name}: ${dollars(c)}`), '- the held total is what the guest pays if they reserve this stay before the hold runs out'], allowedCents: parts.map(([, c]) => c), until: untilText(h.expiresAt) };
}
/** Clock times ("12:00", "3 pm", "noon") and lengths of time in hours or days ("24 hours", "two days") written in a text. */
export function timesIn(text) {
  const clock = text.match(/\b\d{1,2}:\d{2}\b(?:\s?[ap]\.?m\.?)?|\b\d{1,2}\s?[ap]\.?m\b\.?|\b(?:noon|midnight)\b/gi) ?? [];
  const lengths = text.match(/\b(?:\d+|one|two|three|four|five|six|seven|twelve|twenty[- ]four|forty[- ]eight)[- ]?(?:hours?|hrs?|days?)\b/gi) ?? [];
  return [...clock, ...lengths].map((t) => t.trim());
}
/**
 * The check for a held-stay draft: every amount is one code looked up (the same number check), every clock time is the
 * looked-up one, and the draft states no length of time ("24 hours") unless code handed it over. Stay dates are not checked.
 */
export function checkHoldDraft(draft, f) {
  const money = checkDraft(draft, f.allowedCents);
  const allowed = f.until ? [f.until.match(/\d{2}:\d{2}/)[0]] : [];
  const told = f.lines.join('\n').toLowerCase();
  const timesNotLookedUp = timesIn(draft).filter((t) => !allowed.includes(t) && !told.includes(t.toLowerCase()));
  return { ok: money.ok && timesNotLookedUp.length === 0, notLookedUp: money.notLookedUp, timesNotLookedUp, statesUntil: !!f.until && draft.includes(f.until) };
}
