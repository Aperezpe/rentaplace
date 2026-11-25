// The desk's limits, checked in order before the model runs. Each refusal is an AppError with a named code and a reason.
// Spending the daily budget closes only POST /desk: every other route keeps working.
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors.ts';

export type DeskLimits = { maxChars: number; perMinute: number; dailyBudgetUsd: number };
const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback; };
export const deskLimitsFromEnv = (): DeskLimits => ({
  maxChars: num('RAP_DESK_MAX_CHARS', 2000),
  perMinute: num('RAP_DESK_PER_MINUTE', 5),
  dailyBudgetUsd: num('RAP_DESK_DAILY_BUDGET_USD', 1),
});

/** Real time, not RAP_TODAY: rate windows and money spent happen on the wall clock. */
export type Clock = () => number;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function deskSpentToday(db: DatabaseSync, nowMs: number) {
  return Number((db.prepare('SELECT coalesce(sum(cost_usd),0) s FROM desk_usage WHERE day=?').get(utcDay(nowMs)) as any).s);
}

export class DeskGate {
  private recent = new Map<string, number[]>();
  private db: DatabaseSync; private clock: Clock; readonly limits: DeskLimits;
  constructor(db: DatabaseSync, limits: DeskLimits = deskLimitsFromEnv(), clock: Clock = Date.now) { this.db = db; this.limits = limits; this.clock = clock; }

  /** Throws the first limit the message breaks; otherwise counts it against the visitor's minute. Returns the message, trimmed. */
  admit(guestId: string, raw: unknown): string {
    const { maxChars, dailyBudgetUsd } = this.limits, now = this.clock();
    const message = typeof raw === 'string' ? raw.trim() : '';
    if (!message) throw new AppError(400, 'DESK_MESSAGE_EMPTY', 'Send a message for the desk.');
    if (message.length > maxChars) throw new AppError(413, 'DESK_MESSAGE_TOO_LONG', `Messages to the desk can be at most ${maxChars} characters; this one has ${message.length}.`);
    this.checkRate(guestId, now);
    if (deskSpentToday(this.db, now) >= dailyBudgetUsd) throw new AppError(503, 'DESK_BUDGET_SPENT', 'The desk has used its budget for today and is closed until tomorrow (UTC). The rest of the site still works.');
    this.count(guestId, now);
    return message;
  }
  /** An MCP tool call: the same per-visitor minute as desk messages, one shared count. No model runs, so no budget check. */
  admitCall(guestId: string) {
    const now = this.clock();
    this.checkRate(guestId, now);
    this.count(guestId, now);
  }
  private checkRate(guestId: string, now: number) {
    const window = (this.recent.get(guestId) ?? []).filter(t => t > now - 60_000);
    this.recent.set(guestId, window);
    if (window.length >= this.limits.perMinute) {
      const retry = Math.max(1, Math.ceil((window[0] + 60_000 - now) / 1000));
      throw Object.assign(new AppError(429, 'DESK_RATE_LIMITED', `You can send the desk ${this.limits.perMinute} messages or tool calls a minute. Try again in ${retry} seconds.`), { retryAfter: retry });
    }
  }
  private count(guestId: string, now: number) { this.recent.get(guestId)!.push(now); }

  /** What one message cost, written once per request. */
  record(requestId: string, guestId: string, costUsd: number) {
    const now = this.clock();
    this.db.prepare('INSERT OR IGNORE INTO desk_usage VALUES (?,?,?,?,?)').run(requestId, guestId, utcDay(now), Math.max(0, costUsd), new Date(now).toISOString());
  }
}
