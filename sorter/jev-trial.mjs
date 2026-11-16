#!/usr/bin/env node
// A labelled set, sorted by Jev (sorter/jev.mjs) with the "unsure waits for a person" rule, repeated k times.
//   node sorter/jev-trial.mjs <outFolder> [k=15] [first|fresh]
// No retries: a failed call is counted as invalid (no tag). The bars are read from jev.mjs and never changed here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OWNERS, grade } from './core.mjs';
import { ask, decide, MONEY_AT, MONEY_SURE, OWNER_SURE } from './jev.mjs';

const out = resolve(process.argv[2]); const k = Number(process.argv[3] || 15); const set = process.argv[4] || 'first';
const { TICKETS } = await import(set === 'fresh' ? './labelled-fresh.mjs' : './labelled.mjs');
mkdirSync(out, { recursive: true });
const shuffles = [['booking', 'pricing', 'nobody'], ['nobody', 'booking', 'pricing'], ['pricing', 'nobody', 'booking']];
const jobs = []; for (let run = 1; run <= k; run++) for (const t of TICKETS) jobs.push({ run, t, order: shuffles[run % 3] });
const rows = []; let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) { const j = jobs[next++]; let r = { got: null }, error = null; try { r = await ask(j.t, j.order); } catch (e) { error = String(e.message ?? e).slice(0, 160); }
  const d = decide(r.got); // what the sorter would write, or null (no tag)
  rows.push({ run: j.run, id: j.t.id, order: j.order.join('>'), error, ms: r.ms, model: r.model, tokens: r.tokens, got: r.got, decided: d, ...grade(j.t, d),
    // The dangerous case: a money ticket that got a tag saying "not money" and was not marked unsure. Nobody is asked to look.
    moneyMissedSilently: !!d && j.t.money && !d.money && !d.unsure,
    waits: !!d && (d.money || d.unsure), unsure: !!d && d.unsure,
    moneyAtHalf: r.got ? (r.got.moneyP >= 0.5) === j.t.money : false }); } }));
const runs = Array.from({ length: k }, (_, i) => rows.filter((r) => r.run === i + 1));
const n = (rs, f) => rs.filter(f).length;
const ms = rows.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b), tokens = rows.reduce((s, r) => s + (r.tokens || 0), 0);
const label = Object.fromEntries(TICKETS.map((t) => [t.id, t]));
const perTicket = TICKETS.map((t) => { const rs = rows.filter((r) => r.id === t.id && r.got); const span = (f) => rs.length ? [Math.min(...rs.map(f)), Math.max(...rs.map(f))].map((x) => +x.toFixed(3)) : null;
  return { id: t.id, kind: t.kind, subject: t.subject, label: { owner: t.owner, money: t.money }, of: k, valid: rs.length, owners: Object.fromEntries(OWNERS.map((o) => [o, n(rs, (r) => r.got.owner === o)]).filter(([, c]) => c)), ownerRight: n(rs, (r) => r.owner), moneyRight: n(rs, (r) => r.money), moneyMissedSilently: n(rs, (r) => r.moneyMissedSilently), unsure: n(rs, (r) => r.unsure), waits: n(rs, (r) => r.waits), ownerConfidence: span((r) => r.got.ownerConfidence), moneyP: span((r) => r.got.moneyP) }; });
const moneyT = TICKETS.filter((t) => t.money).length, notMoneyT = TICKETS.length - moneyT;
const summary = { set, model: [...new Set(rows.map((r) => r.model).filter(Boolean))], bars: { MONEY_AT, MONEY_SURE, OWNER_SURE }, tickets: TICKETS.length, moneyTickets: moneyT, notMoneyTickets: notMoneyT, k, calls: rows.length, invalid: n(rows, (r) => !r.valid), errors: [...new Set(rows.map((r) => r.error).filter(Boolean))],
  dangerous: { what: 'money ticket tagged not-money and NOT marked unsure', total: n(rows, (r) => r.moneyMissedSilently), ofMoneyCalls: moneyT * k, perRun: runs.map((rs) => n(rs, (r) => r.moneyMissedSilently)), tickets: [...new Set(rows.filter((r) => r.moneyMissedSilently).map((r) => r.id))] },
  moneyFlagWrong: { total: n(rows, (r) => r.valid && !r.money), missedMoney: n(rows, (r) => r.valid && !r.money && label[r.id].money), falseMoney: n(rows, (r) => r.valid && !r.money && !label[r.id].money), tickets: [...new Set(rows.filter((r) => r.valid && !r.money).map((r) => r.id))] },
  moneyWrongWithoutTheRule_at0_5: { total: n(rows, (r) => r.got && !r.moneyAtHalf), tickets: [...new Set(rows.filter((r) => r.got && !r.moneyAtHalf).map((r) => r.id))] },
  ownerWrong: { total: n(rows, (r) => r.valid && !r.owner), andNotUnsure: n(rows, (r) => r.valid && !r.owner && !r.unsure), tickets: [...new Set(rows.filter((r) => r.valid && !r.owner).map((r) => r.id))], ticketsNotUnsure: [...new Set(rows.filter((r) => r.valid && !r.owner && !r.unsure).map((r) => r.id))] },
  cost: { what: 'tickets sent to a person', waitsPerRun: runs.map((rs) => n(rs, (r) => r.waits)), unsurePerRun: runs.map((rs) => n(rs, (r) => r.unsure)), notMoneyTicketsWaitingPerRun: runs.map((rs) => n(rs, (r) => r.waits && !label[r.id].money)), ticketsEverUnsure: [...new Set(rows.filter((r) => r.unsure).map((r) => r.id))] },
  moneyRightPerRun: runs.map((rs) => n(rs, (r) => r.money)), ownerRightPerRun: runs.map((rs) => n(rs, (r) => r.owner)),
  ms: { median: ms[ms.length >> 1], p90: ms[Math.floor(ms.length * 0.9)], max: ms.at(-1) }, inputTokens: tokens, usd: +(tokens * 0.042 / 1e6).toFixed(6) };
writeFileSync(resolve(out, 'results.json'), JSON.stringify({ summary, perTicket, rows }, null, 1));
console.log(JSON.stringify({ summary, perTicket }, null, 1));
