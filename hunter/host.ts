// The error hunter's local durable host (Pi Durable + durable-harness). Ported from the 10 Nov 2026 host proof.
// POST /wake {id, lines:[request.failed line, http.request line]} with a bearer token starts one hunt per event ID.
// Every finished step of the hunt is saved, so a restart carries on from the last one instead of starting over.
// The hunter can only make guest HTTP requests against HUNT_BASE (a copy), and file one report by request number.
// env: HUNT_OUT (folder for host.db), HUNT_BASE (http://127.0.0.1:port of the copy), HUNT_TOKEN, HUNT_ROLE (job.md),
//      HUNT_MODEL (default anthropic/claude-haiku-5-5), HUNT_PI_AUTH (Pi login file, read only), HUNT_CAP (dollars, default 2)
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { Type, createModels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { createRegistry, defineExtension, defineTool, defineDoc, Harness, hook, GenerationTask } from '@earendil-works/pi-durable';
import { getWorld } from 'durable-harness';
import { resumeWith, acquireHarness } from 'durable-harness/pi-durable';

const out = process.env.HUNT_OUT!, base = process.env.HUNT_BASE!, token = process.env.HUNT_TOKEN!;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !token || !out) throw Error('need HUNT_OUT, HUNT_TOKEN and a private local HUNT_BASE');
const modelName = process.env.HUNT_MODEL || 'anthropic/claude-haiku-5-5';
const ref = { provider: modelName.slice(0, modelName.indexOf('/')), modelId: modelName.slice(modelName.indexOf('/') + 1) };
const authFile = process.env.HUNT_PI_AUTH || path.join(process.env.HOME!, '.pi/agent/auth.json');
// The Pi login is read, never written: refreshing it here could log the Pi CLI out.
const refuse = async (): Promise<never> => { throw Error('the Pi login file is read-only here; run pi to refresh it'); };
const loadAuth = () => JSON.parse(fs.readFileSync(authFile, 'utf8'));
const models = createModels({ credentials: { read: async (id: string) => loadAuth()[id], list: async () => Object.entries(loadAuth()).map(([providerId, c]: any) => ({ providerId, type: c.type })), modify: refuse, delete: refuse } as any });
for (const provider of builtinProviders()) models.setProvider(provider);

const db = new DatabaseSync(path.join(out, 'host.db'));
db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS hunts(id TEXT PRIMARY KEY, session TEXT, role TEXT);
 CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY, hunt TEXT, callid TEXT, method TEXT, path TEXT, status INTEGER, response TEXT, UNIQUE(hunt,callid));
 CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, json TEXT);
 CREATE TABLE IF NOT EXISTS jars(id TEXT PRIMARY KEY, cookie TEXT);
 CREATE TABLE IF NOT EXISTS budget(n INTEGER PRIMARY KEY, task TEXT, cost REAL, settled INTEGER);
 CREATE TABLE IF NOT EXISTS wakes(n INTEGER PRIMARY KEY, id TEXT, http INTEGER, status TEXT);`);
const doc = defineDoc({ kind: 'hunter.event', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ id: '' }), checkpointWhen: () => false });
const reply = (s: string) => ({ output: [{ type: 'text', text: s }] });
const operator = /^\/(?:admin|host|api\/(?:host|admin|logs|flags|stats|support|feedback))(?:\/|$)/;

// One guest request. Each gets a number; a step that is replayed after a restart returns the saved answer instead of asking again.
const request = defineTool({
  name: 'http_request', description: 'One guest HTTP request on the disposable product. Returns status, body and receipt number. Cookies persist.', replay: 'safe',
  parameters: Type.Object({ method: Type.Union([Type.Literal('GET'), Type.Literal('POST')]), path: Type.String(), body: Type.Optional(Type.String()) }),
  execute: async (a: any, api: any, c: any) => {
    const { id } = await api.snapshot(doc, api.conversationId, c);
    const existing: any = db.prepare('SELECT * FROM calls WHERE hunt=? AND callid=?').get(id, api.callId);
    if (existing) return reply(existing.response + `\n(request ${existing.id})`);
    if ((db.prepare('SELECT COUNT(*) n FROM calls WHERE hunt=?').get(id) as any).n >= 40) return reply('Visit limit reached. File your report.');
    const url = new URL(a.path, base); const p = decodeURIComponent(url.pathname);
    if (!a.path.startsWith('/') || url.origin !== base || url.username || url.password || p.includes('%') || p.includes('\\') || operator.test(p) || !/^\/api\//.test(p)) return reply('Guest product API only.');
    let body = a.body ? JSON.parse(a.body) : undefined;
    if (a.method === 'POST') {
      if (p === '/api/auth/signin') { if (!['guest-1', 'guest-2'].includes(body?.userId)) return reply('Guest account only.'); }
      else if (p === '/api/bookings') body = { ...body, idempotencyKey: id + '-' + api.callId }; // a repeated step books once
      else return reply('Only guest sign-in and demo booking are writable on this copy.');
    }
    const headers: any = { 'content-type': 'application/json' };
    const jar: any = db.prepare('select cookie from jars where id=?').get(id); if (jar) headers.cookie = jar.cookie;
    const r = await fetch(url, { method: a.method, body: body === undefined ? undefined : JSON.stringify(body), headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const ck = r.headers.getSetCookie?.(); if (ck?.length) db.prepare('INSERT OR REPLACE INTO jars VALUES(?,?)').run(id, ck.map((k) => k.split(';')[0]).join('; '));
    const response = `Status ${r.status}\n` + (await r.text()).slice(0, 70000);
    const n = db.prepare('INSERT INTO calls(hunt,callid,method,path,status,response) VALUES(?,?,?,?,?,?)').run(id, api.callId, a.method, a.path, r.status, response).lastInsertRowid;
    return reply(response + `\n(request ${n})`);
  },
});
// The report names requests by number; code fills in what each one was. A number that was never run, or is in the wrong list, is refused.
const report = defineTool({
  name: 'file_report', description: 'File one report by request numbers; fails are server errors, passes are working neighbours.', replay: 'safe',
  parameters: Type.Object({ reproduced: Type.Boolean(), rule: Type.String(), fails: Type.Array(Type.Integer()), passes: Type.Array(Type.Integer()), notes: Type.Optional(Type.String()) }),
  execute: async (a: any, api: any, c: any) => {
    const { id } = await api.snapshot(doc, api.conversationId, c);
    const rows = (ns: number[], ok: (n: number) => boolean) => ns.map((n) => { const row: any = db.prepare('SELECT id,method,path,status FROM calls WHERE id=? AND hunt=?').get(n, id); if (!row || !ok(Number(row.status))) throw Error('Invalid receipt ' + n + ' for this list'); return row; });
    const data = { ...a, fails: rows(a.fails, (n) => n >= 500), passes: rows(a.passes, (n) => n >= 200 && n < 300) };
    db.prepare('INSERT OR IGNORE INTO reports VALUES(?,?)').run(id, JSON.stringify(data));
    return { ...reply('Filed.'), control: { terminate: true } };
  },
});
// Spend cap: reserve before each model request, settle after.
const pending = new Map();
const meter = hook(GenerationTask, {
  beforeRequest: (_: any, api: any) => { const used = (db.prepare('select coalesce(sum(cost),0) n from budget').get() as any).n; if (Number(used) + 0.5 > Number(process.env.HUNT_CAP || '2')) throw Error('spend cap (includes interrupted requests)'); pending.set(api.taskId, db.prepare('insert into budget(task,cost,settled) values(?,0.5,0)').run(api.taskId).lastInsertRowid); },
  afterResponse: (m: any, api: any) => { const n = pending.get(api.taskId); const cost = m.usage?.cost?.total; if (n && Number.isFinite(cost) && cost > 0 && !['error', 'aborted'].includes(m.stopReason)) { db.prepare('update budget set cost=?,settled=1 where n=? and settled=0').run(cost, n); pending.delete(api.taskId); } },
});
const registry = createRegistry(); registry.install(defineExtension({ name: 'hunter', tools: [request, report], hooks: [meter] }));
const open = resumeWith((storage: any) => Harness.open(storage, { models, registry }, ctx));
await getWorld();

const starting = new Set<string>();
const srv = createServer(async (req, res) => {
  let wakeId = '';
  const send = (s: number, data: any) => { if (req.url === '/wake') db.prepare('INSERT INTO wakes(id,http,status) VALUES(?,?,?)').run(wakeId, s, data.status ?? (s === 202 ? 'accepted' : '')); res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (req.url !== '/wake' || req.method !== 'POST') return send(404, {});
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, {});
  try {
    let txt = ''; for await (const chunk of req) { txt += chunk; if (txt.length > 10000) return send(413, {}); }
    const { id, lines } = JSON.parse(txt); wakeId = String(id);
    if (!/^[\w-]{8,80}$/.test(id) || !Array.isArray(lines) || lines.length !== 2 || lines.some((l: any) => l.requestId !== id)) return send(400, {});
    const role = fs.readFileSync(process.env.HUNT_ROLE!, 'utf8');
    // The same event ID runs once. (Three failed requests from one bug are three IDs: three hunts.)
    const won = db.prepare('INSERT OR IGNORE INTO hunts VALUES(?,NULL,?)').run(id, role);
    const row: any = db.prepare('select session from hunts where id=?').get(id);
    if (!won.changes && (row.session || starting.has(id))) { const done = !!db.prepare('SELECT 1 FROM reports WHERE id=?').get(id); return send(200, { id, status: done ? 'already hunted' : 'in progress', session: row.session }); }
    // A row with no session and nothing starting it means the host died before it accepted the wake: start it now.
    starting.add(id);
    try {
      const lease = await acquireHarness(undefined, open);
      const convo = await lease.harness.root(ctx, { agent: { model: ref, thinkingLevel: 'low', instructions: role }, init: async (tx: any, cid: any) => { (await tx.doc(doc, cid)).id = id; } });
      const session = lease.storage.sessionId;
      await convo.submit({ type: 'input', content: `RentAPlace logged an error. Site: ${base}\nApplication date: 2026-11-09\nLog lines:\n${lines.map((l: any) => JSON.stringify(l)).join('\n')}`, requestId: id }, ctx);
      db.prepare('UPDATE hunts SET session=? WHERE id=?').run(session, id);
      await lease.release();
      return send(202, { id, session });
    } finally { starting.delete(id); }
  } catch (e) { console.error(String(e)); return send(500, { error: 'wake failed' }); }
});
srv.listen(Number(process.env.HUNT_PORT || 0), '127.0.0.1', () => console.log('READY ' + (srv.address() as any).port));
