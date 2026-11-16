// The sorter's plain code. A model only answers two questions about one ticket (who owns it, is it about money);
// everything else is here: which tickets are new, what counts as a valid answer, and the add-only file of tags.
import fs from 'node:fs';

export const OWNERS = ['booking', 'pricing', 'nobody'];

export const INSTRUCTION = `You sort one support ticket for RentAPlace, a vacation-rental site. You do not answer the ticket.
owner: who looks first.
- "booking": the reservation itself: dates, status (pending, confirmed), the confirmation, arrival, the host accepting or declining, checkout as an action.
- "pricing": what a guest pays, what is refunded, what a host receives: prices, fees, tax, refunds, payouts.
- "nobody": neither of those (site speed, amenities, listing settings, safety, anything else). Say "nobody" rather than stretch a team to fit.
money: true when the ticket is about money moving or owed: a refund, a charge, a payout, a price or total, compensation, a deposit. A person looks at these before anything moves. A ticket that only contains a money-sounding word is false.
Reply with one line of JSON and nothing else: {"owner":"booking"|"pricing"|"nobody","money":true|false}`;

export const ticketText = (t) => `Subject: ${t.subject}\nMessage: ${t.message}`;

/** A model's reply → { owner, money }, or null when it is not exactly the shape asked for. Null means no tag is written. */
export function parseReply(text) {
  const m = String(text ?? '').match(/\{[^{}]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!OWNERS.includes(j.owner) || typeof j.money !== 'boolean') return null;
  return { owner: j.owner, money: j.money };
}

/** The control: keyword rules, written before any run and not tuned afterwards. */
export function keywordSort(t) {
  const s = `${t.subject} ${t.message}`.toLowerCase();
  const money = /refund|payout|\bpay|paid|charge|price|\bfee|cost|deposit|\$|money|\bbill/.test(s);
  const owner = /refund|payout|price|\bfee|charge|total|\btax/.test(s) ? 'pricing' : /book|reserv|confirm|arriv|check-?in|check-?out|pending|dates?\b/.test(s) ? 'booking' : 'nobody';
  return { owner, money };
}

/** Is this answer right for a labelled ticket? An array of owners means either is accepted. */
export function grade(t, got) {
  if (!got) return { owner: false, money: false, valid: false };
  return { owner: [t.owner].flat().includes(got.owner), money: got.money === t.money, valid: true };
}

/** New bytes of app.log → ticket IDs of whole `support.received` lines, and where reading stopped. */
export function readArrivals(offset, bytes) {
  const end = bytes.lastIndexOf(0x0a);
  if (end < 0) return { ids: [], next: offset };
  const ids = [];
  for (const text of bytes.subarray(0, end).toString('utf8').split('\n')) {
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    if (line?.event === 'support.received' && typeof line.ticketId === 'string') ids.push(line.ticketId);
  }
  return { ids, next: offset + end + 1 };
}

/** The tags file: one JSON line per ticket, only ever added to. */
export function readTags(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Adds a tag unless that ticket ID already has one. Returns true when a line was written. Never rewrites a line. */
export function addTag(file, row) {
  if (readTags(file).some((r) => r.ticketId === row.ticketId)) return false;
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return true;
}

/**
 * One pass over what arrived. `fetchTickets` returns the inbox or throws (support API down); `sort` asks the model;
 * `read` turns what the model returned into { owner, money, unsure?, why?, … } or null.
 * Offline (the support API or the model cannot be reached): the saved place does not move, so the same arrivals are
 * read again next time. Tickets tagged before the failure keep their one tag.
 * An answer that is not the asked shape: no tag, reported as "unsorted", the place does move (a person sees it in the list).
 */
export async function pass({ offset, bytes, tagsFile, fetchTickets, sort, read = parseReply, model, now = () => new Date().toISOString() }) {
  const { ids, next } = readArrivals(offset, bytes);
  const fresh = [...new Set(ids)].filter((id) => !readTags(tagsFile).some((r) => r.ticketId === id));
  const out = { status: 'ok', arrived: ids.length, tagged: [], already: [...new Set(ids)].length - fresh.length, unsorted: [], missing: [], offset };
  if (!fresh.length) return { ...out, offset: next };
  let inbox;
  try { inbox = await fetchTickets(); } catch (e) { return { ...out, status: 'offline', reason: String(e.message ?? e) }; }
  for (const id of fresh) {
    const t = inbox.find((x) => x.id === id);
    if (!t) { out.missing.push(id); continue; }
    let got = null;
    try { got = read(await sort(t)); } catch (e) { return { ...out, status: 'offline', reason: `the model did not answer for ${id}: ${String(e.message ?? e).slice(0, 200)}` }; }
    if (!got) { out.unsorted.push({ ticketId: id, why: 'the reply was not the asked shape' }); continue; }
    const { owner, money, unsure, why, ...rest } = got;
    const row = { ticketId: id, owner, money, ...(unsure ? { unsure: true, why } : {}), ...(money || unsure ? { waitsFor: 'a person' } : {}), ...rest, model, at: now() };
    if (addTag(tagsFile, row)) out.tagged.push(row);
  }
  return { ...out, offset: next };
}
