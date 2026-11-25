import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { createRegistry, defineDoc, defineExtension, defineTask, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { DB_PATH, ROOT, addDays } from './config.ts';

/**
 * Error hunter. Report only: it never fixes anything and never edits code.
 * The watcher hands it each failed request (status >= 500) or error event. One durable hunt per failure ID
 * runs on a copy of the app and its database, replays the request, tries nearby variations, and writes
 * one report. Hunts live in a pi-durable Harness over SQLite, so a restart continues the same hunt.
 */
export const HUNTS_DIR = process.env.RAP_HUNTS_DIR || resolve(ROOT, 'data/hunts');
export const HUNTER_MODEL = 'anthropic/claude-haiku-5-5';
const ctx = BACKGROUND_CONTEXT;
const MAX_REQUESTS = 16;
const DEMO = { cardNumber: '4242 4242 4242 4242', guestName: 'Test Guest', guestEmail: 'test-guest@example.test' };

export type LoggedRequest = { method: string; path: string; query?: Record<string, unknown>; body?: Record<string, unknown>; status: number; errorCode?: string };
export type Failure = { id: string; line: Record<string, unknown>; request: LoggedRequest | null };
export type Probe = { n: number; label: string; method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null; as: string | null; filled: string[] };
export type Outcome = 'failed' | 'worked' | 'neither';
export type Result = Probe & { status: number; errorCode: string | null; outcome: Outcome; ms: number };
export type Claim = { text: string; requests: number[] };

// ---------- which log lines are failures (code) ----------

/** request.failed is ignored: it always comes with the request's own status-500 line, which carries the replay fields. */
export function failureOf(entry: any): Failure | null {
  if (entry?.event === 'http.request' && Number(entry.status) >= 500 && entry.requestId)
    return { id: String(entry.requestId), line: entry, request: { method: entry.method, path: entry.path, query: entry.query, body: entry.body, status: entry.status, errorCode: entry.errorCode } };
  if (entry?.event === 'outbox.failed') return { id: `outbox-${entry.bookingId}`, line: entry, request: null };
  if (entry?.event === 'server.failed') return { id: `server-${String(entry.time).replace(/[^0-9A-Za-z]/g, '')}`, line: entry, request: null };
  return null;
}

export const safeId = (id: string) => id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
export const reportPath = (id: string, dir = HUNTS_DIR) => join(dir, 'reports', `${safeId(id)}.md`);

// ---------- the plan: replay, then nearby variations (code) ----------

const userFor = (method: string, path: string): string | null =>
  /^\/(api\/)?host\b/.test(path) || (/^\/api\/(listings|calendar|payouts)\b/.test(path) && method !== 'GET') ? 'host-1'
  : /^\/(api\/)?(holds|bookings|trips|book)\b/.test(path) ? 'guest-1' : null;

function probe(n: number, label: string, r: LoggedRequest, query: Record<string, string>, body: Record<string, unknown> | null, path = r.path): Probe {
  const as = userFor(r.method, path), filled: string[] = [];
  let b = body;
  if (r.method !== 'GET' && /^\/(api\/bookings|book)\b/.test(path)) {
    b = { ...(b || {}), ...DEMO };
    filled.push('cardNumber: demo test card ending 4242', `guestName: ${DEMO.guestName}`, `guestEmail: ${DEMO.guestEmail}`);
  }
  if (as) filled.push(`signed in as ${as}`);
  return { n, label, method: r.method, path, query, body: b, as, filled };
}

export function planFor(r: LoggedRequest, homes: { slug: string; region: string }[]): Probe[] {
  const q = Object.fromEntries(Object.entries(r.query || {}).map(([k, v]) => [k, String(v)]));
  const b = r.body && Object.keys(r.body).length ? { ...r.body } : (r.method === 'GET' ? null : {});
  const plan: Probe[] = [probe(1, 'replay as logged', r, q, b)];
  const add = (label: string, change: (o: Record<string, any>) => void, path?: string) => {
    if (plan.length >= MAX_REQUESTS) return;
    const nq = { ...q }, nb = b ? { ...b } : null;
    change(nq); if (nb) change(nb);
    plan.push(probe(plan.length + 1, label, r, Object.fromEntries(Object.entries(nq).map(([k, v]) => [k, String(v)])), nb, path));
  };
  const src: Record<string, any> = { ...q, ...(b || {}) };
  if (src.from && src.to) for (const d of [-7, -3, -1, 1, 3, 7])
    add(`dates shifted ${d > 0 ? '+' : ''}${d} days`, o => { if (o.from) o.from = addDays(String(o.from), d); if (o.to) o.to = addDays(String(o.to), d); });
  const pathSlug = homes.find(h => r.path.split('/').includes(h.slug))?.slug;
  const slug = src.slug ? String(src.slug) : pathSlug;
  if (slug) {
    const region = homes.find(h => h.slug === slug)?.region;
    const others = [...homes.filter(h => h.slug !== slug && h.region === region), ...homes.filter(h => h.slug !== slug && h.region !== region)].slice(0, 4);
    for (const h of others) add(`other home: ${h.slug}${h.region === region ? ' (same region)' : ''}`, o => { if (o.slug) o.slug = h.slug; },
      pathSlug ? r.path.split('/').map(s => (s === pathSlug ? h.slug : s)).join('/') : undefined);
  }
  if (src.guests) for (const g of [1, Number(src.guests) + 1]) if (g !== Number(src.guests)) add(`guests ${g}`, o => { if (o.guests !== undefined) o.guests = typeof o.guests === 'number' ? g : String(g); });
  return plan;
}

export function classify(original: LoggedRequest, status: number, errorCode: string | null): Outcome {
  if (status === original.status && (!original.errorCode || original.errorCode === errorCode)) return 'failed';
  if (status >= 200 && status < 400) return 'worked';
  return 'neither';
}

// ---------- the copy of the app (code) ----------

const copies = new Map<string, { proc: ChildProcess; base: string }>();

function freePort(): Promise<number> {
  return new Promise((done, fail) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => done(p)); }); s.on('error', fail); });
}

/** A copy of the app's code and database under the hunt's folder. Made once per hunt; started again after a restart. */
export async function ensureCopy(id: string, dir: string, sourceDb: string, sourceRoot = ROOT): Promise<string> {
  const live = copies.get(id);
  if (live && live.proc.exitCode === null) return live.base;
  mkdirSync(join(dir, 'work', safeId(id)), { recursive: true });
  // Real path: the server only starts when argv[1] matches its own file, and /var is a symlink on macOS.
  const app = join(realpathSync(join(dir, 'work', safeId(id))), 'app');
  if (!existsSync(join(app, 'data', 'copy.db'))) {
    mkdirSync(join(app, 'data'), { recursive: true });
    for (const part of ['src', 'db', 'package.json']) cpSync(join(sourceRoot, part), join(app, part), { recursive: true });
    for (const f of readdirSync(join(sourceRoot, 'data')).filter(f => f.endsWith('.ts'))) cpSync(join(sourceRoot, 'data', f), join(app, 'data', f));
    if (!existsSync(join(app, 'node_modules'))) symlinkSync(join(sourceRoot, 'node_modules'), join(app, 'node_modules'));
    const src = new DatabaseSync(sourceDb, { readOnly: true });
    try { src.exec(`VACUUM INTO '${join(app, 'data', 'copy.tmp.db').replace(/'/g, "''")}'`); } finally { src.close(); }
    renameSync(join(app, 'data', 'copy.tmp.db'), join(app, 'data', 'copy.db'));
  }
  const pidFile = join(app, 'copy.pid');
  if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {} }
  const port = await freePort();
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(app, 'src', 'server.ts')], {
    cwd: app, stdio: 'ignore',
    env: { ...process.env, RAP_ROOT: app, RAP_DB: join(app, 'data', 'copy.db'), RAP_LOG_DIR: join(app, 'logs'), RAP_OUTBOX_DIR: join(app, 'outbox'), PORT: String(port), RAP_PAGES: 'off', RAP_LOG_STDOUT: '0', RAP_SESSION_SECRET: `hunter-${safeId(id)}` },
  });
  writeFileSync(pidFile, String(proc.pid));
  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 20_000;
  for (;;) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    if (proc.exitCode !== null || Date.now() > end) throw new Error(`the app copy did not start (exit ${proc.exitCode})`);
    await new Promise(r => setTimeout(r, 150));
  }
  copies.set(id, { proc, base });
  return base;
}

export function stopCopy(id: string) { const c = copies.get(id); if (c) { c.proc.kill('SIGTERM'); copies.delete(id); } }
export function stopAllCopies() { for (const id of [...copies.keys()]) stopCopy(id); }

const cookies = new Map<string, string>();
async function send(base: string, p: Probe, original: LoggedRequest): Promise<Result> {
  const started = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (p.as) {
      const key = `${base}|${p.as}`;
      if (!cookies.has(key)) {
        const s = await fetch(`${base}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: p.as }) });
        cookies.set(key, (s.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; '));
      }
      headers.cookie = cookies.get(key)!;
    }
    const qs = new URLSearchParams(p.query).toString();
    const res = await fetch(`${base}${p.path}${qs ? `?${qs}` : ''}`, {
      method: p.method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: p.body ? { ...headers, 'content-type': 'application/json' } : headers,
      body: p.body && p.method !== 'GET' && p.method !== 'HEAD' ? JSON.stringify(p.body) : undefined,
    });
    const json: any = await res.json().catch(() => null);
    const errorCode = json?.error?.code ?? null;
    return { ...p, status: res.status, errorCode, outcome: classify(original, res.status, errorCode), ms: Date.now() - started };
  } catch {
    return { ...p, status: 0, errorCode: 'NO_RESPONSE', outcome: 'neither', ms: Date.now() - started };
  }
}

// ---------- the summary (Haiku) and the claim filter (code) ----------

export type Ask = (system: string, user: string) => Promise<string>;
export const askHaiku: Ask = (system, user) => new Promise((done, fail) => {
  const child = spawn('pi', ['-p', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--thinking', 'off', '--model', HUNTER_MODEL, '--system-prompt', system, user], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  const t = setTimeout(() => child.kill('SIGKILL'), 120_000);
  child.on('close', code => { clearTimeout(t); code === 0 ? done(out.trim()) : fail(new Error(`summary model exited ${code}`)); });
});

const SUMMARY_SYSTEM = `You summarize an error hunt for RentAPlace. A failed request was replayed on a copy of the app and varied.
Using only the numbered requests given, say where the failure happens and where it does not.
Reply with strict JSON only: {"claims":[{"text":"<one short sentence>","requests":[<request numbers this sentence rests on>]}]}.
At most 5 claims. Every claim cites at least one request number. Do not suggest fixes.`;

export function summaryInput(f: Failure, results: Result[]) {
  return `Original failure: ${f.request ? `${f.request.method} ${f.request.path} returned ${f.request.status}` : String(f.line.event)}
Requests:
${results.map(r => `#${r.n} ${r.label}: ${r.method} ${r.path} ${JSON.stringify(r.query)}${r.body ? ` body ${JSON.stringify(Object.fromEntries(Object.entries(r.body).filter(([k]) => !(k in DEMO))))}` : ''} -> ${r.status}${r.errorCode ? ` ${r.errorCode}` : ''} = ${r.outcome}`).join('\n')}`;
}

/** Keeps a claim only when it cites at least one request and every cited number is in the record. */
export function checkClaims(raw: string, results: Result[]): { kept: Claim[]; dropped: Claim[]; invalid: boolean } {
  let parsed: any;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { kept: [], dropped: [], invalid: true }; }
  const claims: Claim[] = (Array.isArray(parsed?.claims) ? parsed.claims : []).map((c: any) => ({ text: String(c?.text ?? ''), requests: Array.isArray(c?.requests) ? c.requests.map(Number) : [] }));
  const known = new Set(results.map(r => r.n));
  const ok = (c: Claim) => c.text.trim() !== '' && c.requests.length > 0 && c.requests.every(n => known.has(n));
  return { kept: claims.filter(ok), dropped: claims.filter(c => !ok(c)), invalid: false };
}

// ---------- the report (code) ----------

const cell = (s: unknown) => String(s).replace(/\|/g, '\\|');
export function renderReport(f: Failure, results: Result[], summary: { kept: Claim[]; dropped: Claim[]; invalid: boolean; error?: string }) {
  const count = (o: Outcome) => results.filter(r => r.outcome === o).length;
  const filled = [...new Set(results.flatMap(r => r.filled))];
  const lines = [`# Error hunt: ${f.id}`, '', 'Report only. Nothing was fixed and no code was edited. Every request ran on a copy of the app and its database.', '',
    '## Original failure', '', '```', JSON.stringify(f.line), '```', ''];
  if (!f.request) {
    lines.push('This failure is not a request, so there was nothing to replay.', '');
    return lines.join('\n');
  }
  lines.push('## Counts (code)', '', '| Outcome | Requests |', '|---|---|', `| failed | ${count('failed')} |`, `| worked | ${count('worked')} |`, `| neither | ${count('neither')} |`, `| total | ${results.length} |`, '',
    'failed = same status (and error code) as the original; worked = 2xx or 3xx; neither = anything else.', '',
    '## Values filled in', '', ...(filled.length ? ['The log does not keep these, so the hunter supplied them:', '', ...filled.map(v => `- ${v}`)] : ['None. Every value came from the log or a variation.']), '',
    '## Requests', '', '| # | Try | Request | Filled in | Status | Outcome |', '|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.n} | ${cell(r.label)} | ${cell(`${r.method} ${r.path}${Object.keys(r.query).length ? `?${new URLSearchParams(r.query)}` : ''}${r.body ? ` ${JSON.stringify(Object.fromEntries(Object.entries(r.body).filter(([k]) => !(k in DEMO))))}` : ''}`)} | ${cell(r.filled.join('; ') || 'none')} | ${r.status}${r.errorCode ? ` ${r.errorCode}` : ''} | ${r.outcome} |`), '',
    '## Summary', '');
  if (summary.error) lines.push(`No summary: ${summary.error}`);
  else if (summary.invalid) lines.push('No summary: the model did not return the JSON asked for.');
  else if (!summary.kept.length) lines.push('No summary claim cited the record, so none is shown.');
  else lines.push(...summary.kept.map(c => `- ${c.text} (${c.requests.map(n => `#${n}`).join(', ')})`));
  if (summary.dropped.length) lines.push('', `${summary.dropped.length} claim(s) dropped for citing no request or a request number not in the record.`);
  lines.push('', `Summary by ${HUNTER_MODEL}; counts, outcomes and the claim check by code.`, '');
  return lines.join('\n');
}

// ---------- the durable hunt ----------

type Checkpoint = { phase: 'plan' } | { phase: 'probe'; n: number; plan: Probe[] } | { phase: 'summarize'; plan: Probe[] } | { phase: 'report'; plan: Probe[] };
type Deps = { dir: string; sourceDb: string; sourceRoot: string; ask: Ask; onRecord?: (id: string, r: Result) => void };
let deps: Deps;

async function results(runtime: any, plan: Probe[], c: any): Promise<Result[]> {
  const out: Result[] = [];
  for (const p of plan) { const r = await runtime.memo(`req-${p.n}`, c); if (r) out.push(r); }
  return out;
}

export const Hunt = defineTask<Failure, Checkpoint, { report: string }>({
  name: 'rap.hunt',
  version: 1,
  initial: () => ({ phase: 'plan' }),
  phases: {
    plan: async (task, runtime, c) => {
      let plan: Probe[] = [];
      if (task.input.request) {
        const db = new DatabaseSync(deps.sourceDb, { readOnly: true });
        let homes: { slug: string; region: string }[];
        try { homes = db.prepare("SELECT slug, region FROM listings WHERE status='active' ORDER BY slug").all() as any; } finally { db.close(); }
        plan = planFor(task.input.request, homes);
      }
      await runtime.commit(() => ({ status: 'running', checkpoint: plan.length ? { phase: 'probe', n: 1, plan } : { phase: 'report', plan } }), c);
    },
    probe: async (task, runtime, c) => {
      const { n, plan } = task.state.checkpoint as Extract<Checkpoint, { phase: 'probe' }>;
      if ((await runtime.memo(`req-${n}`, c)) === undefined) {
        let r: Result;
        try { r = await send(await ensureCopy(task.input.id, deps.dir, deps.sourceDb, deps.sourceRoot), plan[n - 1], task.input.request!); }
        catch (e: any) { r = { ...plan[n - 1], status: 0, errorCode: `COPY_FAILED: ${String(e?.message ?? e).slice(0, 120)}`, outcome: 'neither', ms: 0 }; }
        await runtime.memo(`req-${n}`, JSON.parse(JSON.stringify(r)), c);
        deps.onRecord?.(task.input.id, r);
      }
      await runtime.commit(() => ({ status: 'running', checkpoint: n < plan.length ? { phase: 'probe', n: n + 1, plan } : { phase: 'summarize', plan } }), c);
    },
    summarize: async (task, runtime, c) => {
      const { plan } = task.state.checkpoint as Extract<Checkpoint, { phase: 'summarize' }>;
      stopCopy(task.input.id);
      if ((await runtime.memo('summary', c)) === undefined) {
        const rs = await results(runtime, plan, c);
        let raw: { text?: string; error?: string };
        try { raw = { text: await deps.ask(SUMMARY_SYSTEM, summaryInput(task.input, rs)) }; } catch (e: any) { raw = { error: e.message }; }
        await runtime.memo('summary', raw, c);
      }
      await runtime.commit(() => ({ status: 'running', checkpoint: { phase: 'report', plan } }), c);
    },
    report: async (task, runtime, c) => {
      const { plan } = task.state.checkpoint as Extract<Checkpoint, { phase: 'report' }>;
      const rs = await results(runtime, plan, c);
      const raw: any = (await runtime.memo('summary', c)) ?? {};
      const summary = raw.error ? { kept: [], dropped: [], invalid: false, error: raw.error } : checkClaims(String(raw.text ?? ''), rs);
      const file = reportPath(task.input.id, deps.dir);
      mkdirSync(join(deps.dir, 'reports'), { recursive: true });
      writeFileSync(`${file}.tmp`, renderReport(task.input, rs, summary));
      renameSync(`${file}.tmp`, file);
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { report: file } } }), c);
    },
  },
  abort: (_t, runtime, c) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), c),
});

const Started = defineDoc<{ byFailure: Record<string, string> }>({
  kind: 'rap.hunts', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ byFailure: {} }), checkpointWhen: () => false,
});

export class Hunter {
  harness!: Harness;
  root!: any;
  opts: Partial<Deps>;
  constructor(opts: Partial<Deps> = {}) { this.opts = opts; }

  async open() {
    deps = { dir: this.opts.dir || HUNTS_DIR, sourceDb: this.opts.sourceDb || DB_PATH, sourceRoot: this.opts.sourceRoot || ROOT, ask: this.opts.ask || askHaiku, onRecord: this.opts.onRecord };
    mkdirSync(deps.dir, { recursive: true });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'rap-hunter', tasks: [Hunt] }));
    this.harness = await Harness.open(await openNodeSqliteStorage(join(deps.dir, 'hunts.sqlite')), { models: createModels(), registry }, ctx);
    this.root = await this.harness.root(ctx);
    this.harness.resume(); // continue any hunt a stop or crash left unfinished
    return this;
  }

  /** One hunt per failure ID: skipped when its report exists or a hunt for it was already started. */
  async start(f: Failure): Promise<'started' | 'skipped'> {
    if (existsSync(reportPath(f.id, deps.dir))) return 'skipped';
    const taskId = await this.root.commit(async (tx: any) => {
      const doc = await tx.doc(Started, this.root.id);
      if (doc.byFailure[f.id]) return null;
      const id = await tx.createTask(Hunt, f, { ownership: { kind: 'conversation' } });
      doc.byFailure[f.id] = id;
      return id;
    }, ctx);
    return taskId ? 'started' : 'skipped';
  }

  async waitFor(failureId: string) {
    const doc: any = await this.harness.snapshot(Started, this.root.id, ctx);
    return this.harness.waitForTask(doc.byFailure[failureId], ctx);
  }

  async close() { await this.harness.close(ctx); stopAllCopies(); }
}
