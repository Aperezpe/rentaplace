#!/usr/bin/env node
// Hunts: one glanceable card per finished hunt, read from the error hunter's own store
// (the host's SQLite file: the `reports`, `calls` and `hunts` tables). No model is called here:
// the hunter already wrote the report. This file only reads, checks and orders.
//
//   node hunts.mjs describe
//   node hunts.mjs show [--store <host.db>] [--root <project>]
//   node hunts.mjs act <huntId> send-main --terminal <address> [--dry]     (or: act <huntId> prompt)
//   node hunts.mjs config | config set <key> <value> [--project] | config path
//
// JSON out; errors as {error:{code,message}} on stderr, exit 1.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { defineSettings } from "./settings.mjs";

export const settings = defineSettings("hunts", {
  store: { type: "string", default: "hunter/host.db", meaning: "The hunter host's database file (absolute, or relative to the project)" },
  refreshSeconds: { type: "number", min: 2, default: 10, meaning: "Seconds between reads of the store" },
  maxHunts: { type: "number", min: 1, default: 20, meaning: "How many hunts are shown, newest first" },
});

export class CardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Reads the three tables. Read-only: the card can never change a report. */
export async function readStore(file) {
  if (!fs.existsSync(file)) throw new CardError("STORE_MISSING", `No hunter store at ${file}. Start the hunter host, or point the card at its file: node hunts.mjs config set store <path to host.db>`);
  const { DatabaseSync } = await import("node:sqlite");
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const all = (sql) => db.prepare(sql).all();
    return {
      hunts: all("SELECT rowid AS n, id, session FROM hunts ORDER BY rowid"),
      calls: all("SELECT id, hunt, method, path, status FROM calls ORDER BY id"),
      reports: all("SELECT id, json FROM reports"),
    };
  } catch (e) {
    throw new CardError("STORE_UNREADABLE", `${file} is not a hunter store (${e.message}).`);
  } finally {
    db?.close();
  }
}

const row = (c) => ({ n: Number(c.id), method: String(c.method), path: String(c.path), status: Number(c.status) });
const isFail = (s) => s >= 500;
const isWork = (s) => s >= 200 && s < 300;

/**
 * Turns the store's rows into cards. Plain code, no judgement:
 *  - a request appears only if the host recorded it for THIS hunt (the `calls` table);
 *  - "fails" need a recorded 5xx, "works" a recorded 2xx; a listed number that is missing from the
 *    store, belongs to another hunt, or has another status is dropped and counted in `dropped`;
 *  - "neither" is every recorded request the report put in neither list (intended refusals, sign-ins,
 *    look-ups). The store does not hold what the hunter did NOT try: only its own notes say that.
 */
export function cards(store, { max = 20 } = {}) {
  const callsOf = new Map();
  for (const c of store.calls) (callsOf.get(c.hunt) ?? callsOf.set(c.hunt, new Map()).get(c.hunt)).set(Number(c.id), row(c));
  const reportOf = new Map();
  const broken = new Set();
  for (const r of store.reports) {
    try {
      const j = JSON.parse(r.json);
      if (!j || typeof j !== "object") throw 0;
      reportOf.set(r.id, j);
    } catch {
      broken.add(r.id);
    }
  }
  const out = [];
  for (const h of store.hunts) {
    const made = callsOf.get(h.id) ?? new Map();
    const base = { id: h.id, short: String(h.id).slice(0, 8), order: Number(h.n), requests: made.size };
    const rep = reportOf.get(h.id);
    if (!rep) {
      out.push({ ...base, state: broken.has(h.id) ? "unreadable" : "hunting", fails: [], works: [], neither: [], dropped: [] });
      continue;
    }
    const dropped = [];
    const pick = (list, ok, name) => {
      const seen = new Set();
      const keep = [];
      for (const x of Array.isArray(list) ? list : []) {
        const n = Number(typeof x === "object" && x ? x.id : x);
        const c = made.get(n);
        if (!c) dropped.push({ n, list: name, why: "not a request of this hunt in the store" });
        else if (!ok(c.status)) dropped.push({ n, list: name, why: `the store has status ${c.status}` });
        else if (!seen.has(n)) (seen.add(n), keep.push(c)); // the store's row, never the report's copy
      }
      return keep.sort((a, b) => a.n - b.n);
    };
    const fails = pick(rep.fails, isFail, "fails");
    const works = pick(rep.passes, isWork, "works");
    const cited = new Set([...fails, ...works].map((c) => c.n));
    const neither = [...made.values()].filter((c) => !cited.has(c.n)).sort((a, b) => a.n - b.n);
    out.push({
      ...base,
      state: "reported",
      reproduced: rep.reproduced === true,
      rule: typeof rep.rule === "string" ? rep.rule : "",
      notes: typeof rep.notes === "string" ? rep.notes : "",
      fails,
      works,
      neither,
      dropped,
    });
  }
  out.sort((a, b) => b.order - a.order);
  const shown = out.slice(0, max);
  return {
    hunts: shown,
    hidden: out.length - shown.length,
    counts: { hunts: out.length, reported: out.filter((h) => h.state === "reported").length, hunting: out.filter((h) => h.state === "hunting").length },
  };
}

const nums = (list) => (list.length ? list.map((c) => c.n).join(", ") : "none");
/** What Enter sends to Main: the report as the store has it, by request number, and no instruction to fix. */
export function promptFor(h) {
  if (h.state !== "reported") throw new CardError("NO_REPORT", `Hunt ${h.short} has no report yet.`);
  const lines = (list) => list.map((c) => `  ${c.n}. ${c.method} ${c.path} -> ${c.status}`).join("\n") || "  (none)";
  return [
    `The error hunter filed this report for hunt ${h.id}. It worked on a copy and reports only; it did not fix anything.`,
    `Replayed the logged request: ${h.reproduced ? "yes, same failure" : "NO, it did not reproduce"}.`,
    `Rule, in the hunter's words: ${h.rule}`,
    `Fails (${h.fails.length}), by request number:\n${lines(h.fails)}`,
    `Still works (${h.works.length}):\n${lines(h.works)}`,
    `Made but in neither list (${h.neither.length}): ${nums(h.neither)}`,
    h.notes ? `Hunter's notes: ${h.notes}` : null,
    h.dropped.length ? `The card dropped ${h.dropped.length} listed request(s) the store does not back: ${h.dropped.map((d) => `${d.n} (${d.why})`).join("; ")}` : null,
    "Read it and tell me what you would check first. Do not change any code yet.",
  ].filter(Boolean).join("\n\n");
}

export async function show({ project, env = process.env, storeFlag = null }) {
  const s = settings.load({ project, env });
  const file = path.resolve(project, storeFlag ?? String(s.values.store));
  const doc = { widget: "hunts", store: file, settings: s.values, settings_problems: s.problems.map((p) => p.message), updated_at: Date.now() };
  try {
    const st = fs.existsSync(file) ? fs.statSync(file) : null;
    return { ...doc, ...cards(await readStore(file), { max: Number(s.values.maxHunts) }), store_changed_at: st ? st.mtimeMs : null };
  } catch (e) {
    if (!(e instanceof CardError)) throw e;
    return { ...doc, hunts: [], hidden: 0, counts: { hunts: 0, reported: 0, hunting: 0 }, unavailable: { code: e.code, message: e.message } };
  }
}

function fail(code, message) {
  process.stderr.write(JSON.stringify({ error: { code, message } }) + "\n");
  process.exit(1);
}

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const project = path.resolve(flag("--root") ?? process.cwd());
  const print = (x) => process.stdout.write(JSON.stringify(x, null, 2) + "\n");
  const cmd = argv[0];
  try {
    if (cmd === "describe")
      return print({
        widget: "hunts",
        title: "Hunts",
        what: "One card per finished hunt: what fails, what still works, what the hunter asked that is in neither list, by request number. Read from the hunter host's store; no model call.",
        commands: ["describe", "show [--store <file>] [--root <project>]", "act <huntId> send-main --terminal <address> [--dry]", "act <huntId> prompt", "config", "config set <key> <value> [--project]", "config path"],
        actions: [{ name: "send-main", key: "enter", label: "Send to Main" }],
        settings: settings.describe(),
      });
    if (cmd === "config") return print(settings.command(argv.slice(1).filter((a, i, l) => a !== "--root" && l[i - 1] !== "--root"), { project }));
    if (cmd === "show") return print(await show({ project, storeFlag: flag("--store") }));
    if (cmd === "act") {
      const [, id, action] = argv;
      const doc = await show({ project, storeFlag: flag("--store") });
      if (doc.unavailable) fail(doc.unavailable.code, doc.unavailable.message);
      const h = doc.hunts.find((x) => x.id === id || x.short === id);
      if (!h) fail("NO_HUNT", `No hunt ${id} in ${doc.store}.`);
      const prompt = promptFor(h);
      if (action === "prompt") return print({ id: h.id, prompt });
      if (action !== "send-main") fail("USAGE", "act <huntId> send-main --terminal <address> [--dry] | act <huntId> prompt");
      const terminal = flag("--terminal");
      if (!terminal) fail("NO_MAIN", "send-main without --terminal: no Main conversation to send to");
      const receipt = { id: h.id, action, terminal, command: ["hc", "send", terminal, prompt], prompt, at: Date.now(), dry: argv.includes("--dry") };
      if (!receipt.dry) {
        const r = spawnSync("hc", ["send", terminal, prompt], { encoding: "utf8" });
        if (r.status !== 0) fail("SEND_FAILED", (r.stderr || r.error?.message || "hc send failed").trim().slice(0, 300));
      }
      return print(receipt);
    }
    fail("USAGE", "hunts.mjs describe | show | act | config");
  } catch (e) {
    fail(e.code ?? "FAILED", e.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main(process.argv.slice(2));
