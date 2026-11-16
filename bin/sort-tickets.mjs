#!/usr/bin/env node
// Sort the tickets that arrived since last time: who owns each (Booking, Pricing, nobody yet) and whether it is about money.
//   node bin/sort-tickets.mjs --log logs/app.log --api http://127.0.0.1:5173 --tags support-tags.jsonl --state sorter-state.json [--model provider/id | --model jev] [--watch seconds]
// Reads `support.received` lines from the log, asks RentAPlace for the ticket (read-only), asks a small model the two
// questions (`--model jev`: Jev's two typed questions, and a ticket Jev is unsure about waits for a person), and adds one line per ticket to the tags file. It never changes a ticket, a reservation or a payment.
import fs from 'node:fs';
import { pass, INSTRUCTION, ticketText } from '../sorter/core.mjs';
import { write } from '../drafts/writer.mjs';
import { ask, decide, MODEL as JEV } from '../sorter/jev.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = arg('--log', 'logs/app.log'), api = arg('--api', 'http://127.0.0.1:5173'), tagsFile = arg('--tags', 'support-tags.jsonl'), stateFile = arg('--state', 'sorter-state.json');
const model = arg('--model', process.env.SORTER_MODEL || 'anthropic/claude-haiku-5-5');
const fetchTickets = async () => { const r = await fetch(`${api}/api/support`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw Error(`support API answered ${r.status}`); return (await r.json()).items; };

async function once() {
  const offset = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).offset : 0;
  const size = fs.existsSync(log) ? fs.statSync(log).size : 0;
  const bytes = size > offset ? fs.readFileSync(log).subarray(offset) : Buffer.alloc(0);
  const how = model === 'jev' ? { model: JEV, sort: (t) => ask(t), read: (a) => decide(a.got) } : { model, sort: (t) => write(model, INSTRUCTION, ticketText(t)) };
  const r = await pass({ offset, bytes, tagsFile, fetchTickets, ...how });
  if (r.offset !== offset) { fs.writeFileSync(stateFile + '.tmp', JSON.stringify({ offset: r.offset })); fs.renameSync(stateFile + '.tmp', stateFile); }
  console.log(JSON.stringify(r));
  return r;
}
const every = Number(arg('--watch', 0));
if (!every) await once();
else for (;;) { await once(); await new Promise((r) => setTimeout(r, every * 1000)); }
