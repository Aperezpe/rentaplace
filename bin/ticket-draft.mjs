#!/usr/bin/env node
// Ticket → draft. For every sorted ticket that Booking or Pricing owns and that has no draft yet: code reads the stay
// from the ticket, looks up the quote, a no-tools model writes, code checks every amount. One outcome per ticket ID.
// A ticket that names one hold (HOLD-1A2B3C4D) is answered from the hold row instead: until when it is held and at what price
// are looked up by code (--db, read-only; --clock decides whether it has run out), and code checks the time and the amounts.
// Who writes and who owns: Booking is the one voice that writes to guests, so every draft is written and signed by Booking.
// The sorter's owner tag is kept on the draft as `askIfWrong`: whose rules the answer rests on, and who to ask when it is wrong.
//   node bin/ticket-draft.mjs --api http://127.0.0.1:5173 --tags support-tags.jsonl --out drafts-out [--model provider/id] [--db data/rentaplace.db] [--clock ISO]
// Outcomes (each add-only, keyed by ticket ID): drafts.jsonl "waiting for a person", rejected.jsonl, no-draft.jsonl.
// Nothing is sent, and no ticket is changed.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { readTags } from '../sorter/core.mjs';
import { customerFacing, facts, checkDraft, writerPrompt } from '../drafts/core.mjs';
import { stayFromText, unreadFacts } from '../drafts/ticket.mjs';
import { holdRefIn, lookUpHold, holdFacts, checkHoldDraft } from '../drafts/hold.mjs';
import { write } from '../drafts/writer.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const api = arg('--api', 'http://127.0.0.1:5173'), tagsFile = arg('--tags', 'support-tags.jsonl'), out = path.resolve(arg('--out', 'drafts-out')), model = arg('--model', 'anthropic/claude-haiku-5-5'), dbFile = arg('--db', null), clock = arg('--clock', new Date().toISOString());
fs.mkdirSync(out, { recursive: true });
const FILES = ['drafts.jsonl', 'rejected.jsonl', 'no-draft.jsonl'];
const done = new Set(FILES.flatMap((f) => readTags(path.join(out, f)).map((r) => r.id)));
const add = (file, row) => fs.appendFileSync(path.join(out, file), JSON.stringify(row) + '\n');
const todo = readTags(tagsFile).filter((t) => !done.has(t.ticketId));
const result = { status: 'ok', drafted: [], rejected: [], noDraft: [], already: readTags(tagsFile).length - todo.length };
const get = async (p) => fetch(`${api}${p}`, { signal: AbortSignal.timeout(5000) });
let inbox = null;
if (todo.length) { try { const r = await get('/api/support'); if (!r.ok) throw Error(`support API answered ${r.status}`); inbox = (await r.json()).items; } catch (e) { result.status = 'offline'; result.reason = String(e.message ?? e); } }
const notes = customerFacing(fs.readFileSync(path.join(root, 'agents/booking/memories.md'), 'utf8'));
for (const tag of inbox ? todo : []) {
  const id = tag.ticketId; const at = new Date().toISOString();
  if (done.has(id)) continue; // the same ticket ID twice in the tags file
  done.add(id);
  const t = inbox.find((x) => x.id === id);
  if (!t) { add('no-draft.jsonl', { id, at, why: 'the ticket is not in the inbox' }); result.noDraft.push(id); continue; }
  if (!['booking', 'pricing'].includes(tag.owner)) { add('no-draft.jsonl', { id, at, why: 'nobody owns this ticket yet' }); result.noDraft.push(id); continue; }
  const question = `${t.subject}\n${t.message}`;
  const read = await stayFromText(question, async (slug) => { try { return (await get(`/api/listings/${slug}`)).status === 200; } catch { return false; } });
  const holdRef = dbFile ? holdRefIn(question) : null;
  let f, lookup = 'not tried: the stay could not be read';
  if (holdRef) { const l = lookUpHold(dbFile, holdRef, clock); f = holdFacts(holdRef, l); lookup = l.ok ? `hold ${l.hold.status}` : `hold lookup failed: ${l.reason}`; }
  else if (read.ok) {
    let l; try { const r = await get(`/api/quote?${new URLSearchParams({ slug: read.stay.slug, from: read.stay.from, to: read.stay.to, guests: String(read.stay.guests) })}`); const q = r.status === 200 ? await r.json() : null; l = q && Number.isInteger(q.totalCents) ? { ok: true, quote: q } : { ok: false, reason: `HTTP ${r.status}` }; } catch (e) { l = { ok: false, reason: String(e.cause?.code ?? e.name ?? e) }; }
    f = facts(read.stay, l); lookup = l.ok ? 'ok' : `failed: ${l.reason}`;
  } else f = unreadFacts(read.missing);
  const { system, prompt } = writerPrompt({ question, factLines: f.lines, notes });
  let draft; try { draft = await write(model, system, prompt); } catch (e) { done.delete(id); result.status = 'writer failed'; result.reason = String(e.message ?? e).slice(0, 200); break; } // no outcome written: tried again next time
  const check = holdRef ? checkHoldDraft(draft, f) : checkDraft(draft, f.allowedCents);
  const row = { id, at, model, writtenBy: 'booking', askIfWrong: tag.owner, owner: tag.owner, money: tag.money, ...(holdRef ? { hold: holdRef } : {}), stay: read.ok ? read.stay : null, stayNotRead: read.ok ? null : read.missing, lookup, facts: f.lines, draft, status: check.ok ? 'waiting for a person' : 'rejected by the number check', ...(check.ok ? {} : { notLookedUp: check.notLookedUp, ...(check.timesNotLookedUp ? { timesNotLookedUp: check.timesNotLookedUp } : {}) }) };
  add(check.ok ? 'drafts.jsonl' : 'rejected.jsonl', row); (check.ok ? result.drafted : result.rejected).push(id);
}
console.log(JSON.stringify(result));
