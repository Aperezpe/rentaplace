import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cards, promptFor, CardError } from "../hunts.mjs";

const helper = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "hunts.mjs");
const call = (id, hunt, status, p = "/api/quote?x=" + id) => ({ id, hunt, method: "GET", path: p, status });
const STORE = () => ({
  hunts: [{ n: 1, id: "hunt-aaaa-1", session: "s1" }, { n: 2, id: "hunt-bbbb-2", session: "s2" }],
  calls: [call(1, "hunt-aaaa-1", 500), call(2, "hunt-aaaa-1", 200), call(3, "hunt-aaaa-1", 409), call(4, "hunt-aaaa-1", 200), call(5, "hunt-bbbb-2", 500)],
  reports: [{ id: "hunt-aaaa-1", json: JSON.stringify({ reproduced: true, rule: "December stays fail.", fails: [{ id: 1 }], passes: [{ id: 2 }], notes: "Looked to January." }) }],
});

test("a card shows the store's rows by request number; what is in neither list is listed as neither", () => {
  const { hunts, counts } = cards(STORE());
  const a = hunts.find((h) => h.id === "hunt-aaaa-1");
  assert.deepEqual(a.fails.map((c) => c.n), [1]);
  assert.deepEqual(a.works.map((c) => c.n), [2]);
  assert.deepEqual(a.neither.map((c) => [c.n, c.status]), [[3, 409], [4, 200]]);
  assert.equal(a.requests, 4);
  assert.deepEqual(a.dropped, []);
  assert.deepEqual(counts, { hunts: 2, reported: 1, hunting: 1 });
});

test("a hunt with no report is 'hunting', never a card with made-up lists; newest first", () => {
  const { hunts } = cards(STORE());
  assert.equal(hunts[0].id, "hunt-bbbb-2");
  assert.equal(hunts[0].state, "hunting");
  assert.deepEqual([hunts[0].fails, hunts[0].works, hunts[0].rule], [[], [], undefined]);
  assert.throws(() => promptFor(hunts[0]), CardError);
});

test("control: a report that lists a request the store does not back is cut down to what the store has", () => {
  const s = STORE();
  // 99 was never made; 5 belongs to another hunt; 3 is a 409, not a server error; 1 is a 500 listed as working.
  s.reports[0].json = JSON.stringify({ reproduced: true, rule: "r", fails: [{ id: 1, path: "/api/INVENTED", status: 500 }, { id: 99 }, { id: 5 }, { id: 3 }], passes: [2, 1] });
  const a = cards(s).hunts.find((h) => h.id === "hunt-aaaa-1");
  assert.deepEqual(a.fails.map((c) => c.n), [1]);
  assert.equal(a.fails[0].path, "/api/quote?x=1", "the path is the store's, not the report's copy");
  assert.deepEqual(a.works.map((c) => c.n), [2]);
  assert.deepEqual(a.dropped.map((d) => d.n).sort((x, y) => x - y), [1, 3, 5, 99]);
  assert.match(promptFor(a), /dropped 4 listed request/);
});

test("a report that is not JSON is 'unreadable', and maxHunts keeps the newest", () => {
  const s = STORE();
  s.reports[0].json = "{nope";
  assert.equal(cards(s).hunts.find((h) => h.id === "hunt-aaaa-1").state, "unreadable");
  const cut = cards(STORE(), { max: 1 });
  assert.deepEqual([cut.hunts.length, cut.hidden, cut.hunts[0].id], [1, 1, "hunt-bbbb-2"]);
});

test("the prompt for Main carries the numbers and never asks for a fix", () => {
  const a = cards(STORE()).hunts.find((h) => h.id === "hunt-aaaa-1");
  const p = promptFor(a);
  assert.match(p, /1\. GET \/api\/quote\?x=1 -> 500/);
  assert.match(p, /in neither list \(2\): 3, 4/);
  assert.match(p, /Do not change any code yet/);
});

// The command line against a real SQLite file shaped like the host's.
function db(dir) {
  const file = path.join(dir, "host.db");
  const d = new DatabaseSync(file);
  d.exec("CREATE TABLE hunts(id TEXT PRIMARY KEY, session TEXT, role TEXT); CREATE TABLE calls(id INTEGER PRIMARY KEY, hunt TEXT, callid TEXT, method TEXT, path TEXT, status INTEGER, response TEXT, UNIQUE(hunt,callid)); CREATE TABLE reports(id TEXT PRIMARY KEY, json TEXT);");
  const s = STORE();
  for (const h of s.hunts) d.prepare("INSERT INTO hunts VALUES(?,?,?)").run(h.id, h.session, "role");
  for (const c of s.calls) d.prepare("INSERT INTO calls VALUES(?,?,?,?,?,?,?)").run(c.id, c.hunt, "c" + c.id, c.method, c.path, c.status, "");
  for (const r of s.reports) d.prepare("INSERT INTO reports VALUES(?,?)").run(r.id, r.json);
  d.close();
  return file;
}
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hunts-card-")));
const run = (argv, env = {}) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", helper, ...argv], { encoding: "utf8", env: { ...process.env, HERDR_HUNTS_CONFIG: "/nonexistent/config.json", ...env } });

test("show reads the file and leaves it unchanged; a missing store is 'unavailable', not an empty list", () => {
  const dir = tmp();
  const file = db(dir);
  const before = fs.readFileSync(file);
  const r = run(["show", "--root", dir, "--store", file]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.counts.reported, 1);
  assert.deepEqual(before, fs.readFileSync(file));
  const none = JSON.parse(run(["show", "--root", dir]).stdout);
  assert.equal(none.unavailable.code, "STORE_MISSING");
  assert.match(none.unavailable.message, /config set store/);
});

test("send-main: --dry prints the hc command; no terminal, no report and no such hunt are named errors", () => {
  const dir = tmp();
  const file = db(dir);
  const ok = JSON.parse(run(["act", "hunt-aaaa-1", "send-main", "--root", dir, "--store", file, "--terminal", "t9", "--dry"]).stdout);
  assert.deepEqual(ok.command.slice(0, 3), ["hc", "send", "t9"]);
  const code = (argv) => JSON.parse(run(argv).stderr.trim().split("\n").pop()).error.code;
  assert.equal(code(["act", "hunt-aaaa-1", "send-main", "--root", dir, "--store", file]), "NO_MAIN");
  assert.equal(code(["act", "hunt-bbbb-2", "send-main", "--root", dir, "--store", file, "--terminal", "t9", "--dry"]), "NO_REPORT");
  assert.equal(code(["act", "nope", "prompt", "--root", dir, "--store", file]), "NO_HUNT");
});

test("settings: default < user file < project file < environment; unknown key and broken file are shown; config set validates", () => {
  const dir = tmp();
  const user = path.join(dir, "config.json");
  fs.mkdirSync(path.join(dir, ".herdr"));
  const cfg = (env = {}) => JSON.parse(run(["config", "--root", dir], { HERDR_HUNTS_CONFIG: user, ...env }).stdout);
  assert.deepEqual([cfg().settings.maxHunts.value, cfg().settings.maxHunts.from], [20, "default"]);
  fs.writeFileSync(user, JSON.stringify({ maxHunts: 5, colour: "red" }));
  assert.deepEqual([cfg().settings.maxHunts.value, cfg().settings.maxHunts.from], [5, "user file"]);
  assert.ok(cfg().problems.some((p) => /colour/.test(p.message)));
  fs.writeFileSync(path.join(dir, ".herdr", "hunts.json"), JSON.stringify({ maxHunts: 7 }));
  assert.equal(cfg().settings.maxHunts.from, "project file");
  assert.deepEqual([cfg({ HERDR_HUNTS_MAX_HUNTS: "3" }).settings.maxHunts.value, cfg({ HERDR_HUNTS_MAX_HUNTS: "3" }).settings.maxHunts.from], [3, "environment"]);
  const set = run(["config", "set", "refreshSeconds", "30", "--root", dir], { HERDR_HUNTS_CONFIG: user });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(JSON.parse(fs.readFileSync(user, "utf8")).refreshSeconds, 30);
  assert.equal(run(["config", "set", "refreshSeconds", "0", "--root", dir], { HERDR_HUNTS_CONFIG: user }).status, 1);
  fs.writeFileSync(user, "{broken");
  const doc = JSON.parse(run(["show", "--root", dir, "--store", db(tmp())], { HERDR_HUNTS_CONFIG: user }).stdout);
  assert.ok(doc.settings_problems.length >= 1);
  assert.equal(doc.counts.hunts, 2, "defaults still in use");
});
