#!/usr/bin/env node
// Draft a reply to a guest's quote question in two steps. Code looks up the quote and picks the notes; a no-tools model writes;
// code checks every amount in the draft. A draft that passes waits in drafts.jsonl for a person. Nothing is ever sent.
// usage: node bin/booking-draft.mjs --base http://127.0.0.1:5180 --slug lakeside-a-frame --from 2026-11-16 --to 2026-11-19 [--guests 2]
//          [--model anthropic/claude-haiku-5-5] [--out drafts-out] [--id ticket-id] "the guest's message"
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerFacing, facts, checkDraft, writerPrompt } from '../drafts/core.mjs';
import { write } from '../drafts/writer.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const base = flag('--base', 'http://127.0.0.1:5180'), model = flag('--model', 'anthropic/claude-haiku-5-5'), out = resolve(flag('--out', join(root, 'lab-reports/drafts'))), id = flag('--id', null);
const stay = { slug: flag('--slug'), from: flag('--from'), to: flag('--to'), guests: Number(flag('--guests', 2)) };
const question = args.join(' ').trim();
if (!question || !stay.slug || !stay.from || !stay.to) { console.error('usage: node bin/booking-draft.mjs --base URL --slug S --from D --to D [--guests N] "the guest\'s message"'); process.exit(2); }

/** The one lookup. Any failure (network, timeout, a status other than 200, a body that is not a quote) is a failed lookup. */
export async function lookUpQuote(base, stay) {
  try {
    const res = await fetch(`${base}/api/quote?${new URLSearchParams({ slug: stay.slug, from: stay.from, to: stay.to, guests: String(stay.guests) })}`, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
    const quote = await res.json();
    if (!Number.isInteger(quote.totalCents)) return { ok: false, reason: 'no total in the answer' };
    return { ok: true, quote };
  } catch (error) { return { ok: false, reason: String(error.cause?.code ?? error.name ?? error) }; }
}
const lookup = await lookUpQuote(base, stay);
const f = facts(stay, lookup);
const notes = customerFacing(readFileSync(join(root, 'agents/booking/memories.md'), 'utf8'));
const { system, prompt } = writerPrompt({ question, factLines: f.lines, notes });
const draft = await write(model, system, prompt);
const check = checkDraft(draft, f.allowedCents);
mkdirSync(out, { recursive: true });
const row = { id, at: new Date().toISOString(), model, question, stay, lookup: lookup.ok ? 'ok' : `failed: ${lookup.reason}`, facts: f.lines, draft, ...(check.ok ? { status: 'waiting for a person' } : { status: 'rejected by the number check', notLookedUp: check.notLookedUp }) };
appendFileSync(join(out, check.ok ? 'drafts.jsonl' : 'rejected.jsonl'), JSON.stringify(row) + '\n');
console.log(check.ok ? `Draft waiting for a person (${lookup.ok ? 'quote looked up' : 'price unknown: ' + lookup.reason}):\n\n${draft}` : `Rejected: the draft states ${check.notLookedUp.map((a) => a.text).join(', ')}, which code never looked up.\n\n${draft}`);
process.exit(check.ok ? 0 : 1);
