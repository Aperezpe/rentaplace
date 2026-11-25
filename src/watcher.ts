import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOG_DIR, WATCHER_DIR } from './config.ts';
import { sortTicket } from './sorter.ts';
import { HUNTS_DIR, Hunter, failureOf, type Failure } from './hunter.ts';

/**
 * Runs outside the app. Tails the app log and runs the sorter once per support.received ticket.
 * The app never waits on it: stopping the watcher, or Jev being down, only delays sorting.
 */
export type WatcherState = { ino: number | null; offset: number; lastTicketId: string | null; done: string[] };
type Sorter = (ticketId: string) => Promise<{ skipped?: boolean } | void>;
type HunterLike = { start(f: Failure): Promise<'started' | 'skipped'>; close?(): Promise<void> };
type Options = { logPath?: string; dir?: string; sorter?: Sorter; hunter?: HunterLike | null; pollMs?: number; retryMs?: number; maxRetryMs?: number; say?: (event: string, detail?: object) => void };
type Outcome = 'ignored' | 'duplicate' | 'done' | 'retry' | 'hunt';

const fresh = (): WatcherState => ({ ino: null, offset: -1, lastTicketId: null, done: [] });

export class Watcher {
  logPath: string; dir: string; statePath: string; lockPath: string; pollMs: number; retryMs: number; maxRetryMs: number;
  sorter: Sorter;
  say: (event: string, detail?: object) => void;
  state: WatcherState;
  done: Set<string>;
  timer: NodeJS.Timeout | null = null;
  running: Promise<void> | null = null;
  retryAt = 0;
  hunter: HunterLike | null | undefined;
  failures = 0;

  constructor(options: Options = {}) {
    this.logPath = options.logPath || join(LOG_DIR, 'app.log');
    this.dir = options.dir || WATCHER_DIR;
    this.statePath = join(this.dir, 'bookmark.json');
    this.lockPath = join(this.dir, 'watcher.lock');
    this.pollMs = options.pollMs ?? 200;
    this.retryMs = options.retryMs ?? Number(process.env.RAP_WATCHER_RETRY_MS || 5000);
    this.maxRetryMs = options.maxRetryMs ?? 60_000;
    this.sorter = options.sorter || (id => sortTicket(id, this.dir));
    this.hunter = options.hunter;
    this.say = options.say || ((event, detail = {}) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), event, ...detail }) + '\n'));
    mkdirSync(this.dir, { recursive: true });
    const saved = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : {};
    this.state = { ino: saved.ino ?? null, offset: saved.offset ?? -1, lastTicketId: saved.lastTicketId ?? null, done: saved.done ?? [] };
    this.done = new Set(this.state.done);
  }

  /** Writes the bookmark with a temporary file and rename, so a crash never leaves half a bookmark. */
  save() {
    const tmp = this.statePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    renameSync(tmp, this.statePath);
  }

  /**
   * One log line. A ticket in "done" is a duplicate and never runs again.
   * The sorter saves its tag first; only then does the ticket go into "done".
   * If the sorter fails (Jev offline, invalid answer), nothing moves and the line is tried again later.
   */
  async handleLine(line: string): Promise<Outcome> {
    let entry: any;
    try { entry = JSON.parse(line); } catch { return 'ignored'; }
    const failure = failureOf(entry);
    if (failure) return this.hunt(failure);
    if (entry?.event !== 'support.received' || typeof entry.ticketId !== 'string') return 'ignored';
    const id = entry.ticketId;
    if (this.done.has(id)) { this.say('watcher.duplicate', { ticketId: id }); return 'duplicate'; }
    this.say('watcher.sorting', { ticketId: id });
    try {
      const result = await this.sorter(id);
      this.done.add(id);
      this.state.done.push(id);
      this.state.lastTicketId = id;
      this.say('watcher.sorted', { ticketId: id, ...(result && result.skipped ? { skipped: 'tag already saved' } : {}) });
      return 'done';
    } catch (error) {
      this.failures++;
      const wait = Math.min(this.retryMs * 2 ** (this.failures - 1), this.maxRetryMs);
      this.retryAt = Date.now() + wait;
      this.say('sorter.offline', { ticketId: id, reason: error instanceof Error ? error.message : String(error), retryInMs: wait });
      return 'retry';
    }
  }

  /** The error hunter, opened on first use (or at start when hunts exist), so a watcher with no failures never loads it. */
  async getHunter(): Promise<HunterLike | null> {
    if (this.hunter === undefined) this.hunter = await new Hunter().open();
    return this.hunter;
  }

  /** A failed request or error event: start (or skip) its hunt. The line counts as handled once the hunt is stored. */
  async hunt(failure: Failure): Promise<Outcome> {
    try {
      const hunter = await this.getHunter();
      if (!hunter) return 'ignored';
      const result = await hunter.start(failure);
      this.say(result === 'started' ? 'hunter.started' : 'hunter.skipped', { failureId: failure.id });
      return 'hunt';
    } catch (error) {
      this.failures++;
      const wait = Math.min(this.retryMs * 2 ** (this.failures - 1), this.maxRetryMs);
      this.retryAt = Date.now() + wait;
      this.say('hunter.offline', { failureId: failure.id, reason: error instanceof Error ? error.message : String(error), retryInMs: wait });
      return 'retry';
    }
  }

  /** Reads whatever landed since the bookmark, one complete line at a time. The offset moves past a line only after its work is done. */
  async tick() {
    if (Date.now() < this.retryAt) return;
    if (!existsSync(this.logPath)) { if (this.state.offset < 0) { this.state.offset = 0; this.save(); } return; }
    const stat = statSync(this.logPath);
    if (this.state.offset < 0) { this.state = { ...this.state, ino: stat.ino, offset: stat.size }; this.save(); return; }
    if (this.state.ino === null) this.state.ino = stat.ino;
    if (this.state.ino !== stat.ino || stat.size < this.state.offset) {
      this.say('watcher.log_replaced', { from: this.state.offset });
      this.state.ino = stat.ino; this.state.offset = 0;
    }
    if (stat.size === this.state.offset) return;
    const fd = openSync(this.logPath, 'r');
    const buffer = Buffer.alloc(stat.size - this.state.offset);
    try { readSync(fd, buffer, 0, buffer.length, this.state.offset); } finally { closeSync(fd); }
    const text = buffer.toString('utf8');
    let start = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
      const line = text.slice(start, nl);
      const outcome = await this.handleLine(line);
      if (outcome === 'retry') { this.save(); return; }
      if (outcome === 'done' && this.failures) { this.say('sorter.online', { afterFailures: this.failures }); this.failures = 0; }
      this.state.offset += Buffer.byteLength(line) + 1;
      start = nl + 1;
      if (outcome !== 'ignored') this.save();
    }
    this.save();
  }

  /** Serial: a tick never overlaps the previous one. */
  poll() {
    if (this.running) return this.running;
    this.running = this.tick().catch(error => this.say('watcher.error', { message: error.message })).finally(() => { this.running = null; });
    return this.running;
  }

  lock() {
    if (existsSync(this.lockPath)) {
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      try { process.kill(pid, 0); throw new Error(`Another watcher is running (pid ${pid}).`); }
      catch (error: any) { if (error.code !== 'ESRCH') throw error; }
    }
    writeFileSync(this.lockPath, String(process.pid));
  }

  async start() {
    this.lock();
    if (this.hunter === undefined && existsSync(join(HUNTS_DIR, 'hunts.sqlite'))) await this.getHunter();
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.say('watcher.started', { log: this.logPath, offset: this.state.offset, lastTicketId: this.state.lastTicketId });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
    await this.hunter?.close?.();
    try { unlinkSync(this.lockPath); } catch {}
    this.say('watcher.stopped', { offset: this.state.offset, lastTicketId: this.state.lastTicketId });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const watcher = new Watcher();
  const quit = async () => { await watcher.stop(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  watcher.start().catch(error => { process.stderr.write(error.message + '\n'); process.exit(1); });
}
