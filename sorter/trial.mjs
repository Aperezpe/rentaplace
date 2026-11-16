#!/usr/bin/env node
// Repeat the sort on the labelled set and count, so "every time" is said from every run, not from one.
//   node sorter/trial.mjs <outFolder> [k=5] [model,model…] [first|fresh]
// One ticket per call, as on arrival. Controls: keyword rules (same answer every run), and run 1 read alone.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INSTRUCTION, ticketText, parseReply, keywordSort, grade } from './core.mjs';
import { write, spent } from '../drafts/writer.mjs';

const out = resolve(process.argv[2]); const k = Number(process.argv[3] || 5);
const MODELS = (process.argv[4] || 'anthropic/claude-haiku-4-5,anthropic/claude-haiku-5-5').split(',');
const { TICKETS } = await import(process.argv[5] === 'fresh' ? './labelled-fresh.mjs' : './labelled.mjs');
mkdirSync(out, { recursive: true });
const jobs = []; for (const model of MODELS) for (let run = 1; run <= k; run++) for (const t of TICKETS) jobs.push({ model, run, t });
const rows = []; let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++]; let reply = '', error = null;
    try { reply = await write(j.model, INSTRUCTION, ticketText(j.t)); } catch (e) { error = String(e.message ?? e).slice(0, 200); }
    const got = error ? null : parseReply(reply);
    rows.push({ model: j.model, run: j.run, id: j.t.id, reply, error, got, ...grade(j.t, got) });
  }
}));
const summary = {};
const summarize = (name, runsOf) => {
  const runs = runsOf.map((rs) => ({ money: rs.filter((r) => r.money).length, owner: rs.filter((r) => r.owner).length, invalid: rs.filter((r) => !r.valid).length, moneyMissed: rs.filter((r) => !r.money).map((r) => r.id), ownerMissed: rs.filter((r) => !r.owner).map((r) => `${r.id}→${r.got?.owner ?? 'none'}`) }));
  const every = (key) => TICKETS.filter((t) => runsOf.every((rs) => rs.find((r) => r.id === t.id)?.[key])).length;
  summary[name] = { tickets: TICKETS.length, k: runsOf.length, moneyRightPerRun: runs.map((r) => r.money), ownerRightPerRun: runs.map((r) => r.owner), invalidPerRun: runs.map((r) => r.invalid), ticketsWithMoneyRightInEveryRun: every('money'), ticketsWithOwnerRightInEveryRun: every('owner'), run1Alone: { money: runs[0].money, owner: runs[0].owner }, moneyMissedPerRun: runs.map((r) => r.moneyMissed), ownerMissedPerRun: runs.map((r) => r.ownerMissed) };
};
for (const model of MODELS) summarize(model, Array.from({ length: k }, (_, i) => rows.filter((r) => r.model === model && r.run === i + 1)));
// Keyword rules give the same answer every time, so k runs of them are k copies of one run.
const kw = TICKETS.map((t) => { const got = keywordSort(t); return { id: t.id, got, ...grade(t, got) }; });
summarize('keyword rules (control)', Array.from({ length: k }, () => kw));
writeFileSync(resolve(out, 'results.json'), JSON.stringify({ k, models: MODELS, spentUsd: spent, summary, keyword: kw, rows }, null, 1));
console.log(JSON.stringify({ spentUsd: spent, summary }, null, 1));
