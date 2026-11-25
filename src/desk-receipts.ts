// One receipt line per POST /desk visit, refusals included, written by code in data/desk/receipts.jsonl.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eventsFor, type DeskEvent } from './desk-key.ts';

/** What the model run used. Filled by desk() from Pi's own usage numbers; zero when no model started. */
export type Meter = { promptTokens: number; cachedTokens: number; costUsd: number; modelStarted: boolean; failed: boolean };
export const newMeter = (): Meter => ({ promptTokens: 0, cachedTokens: 0, costUsd: 0, modelStarted: false, failed: false });

export type Receipt = {
  at: string; requestId: string; visitor: string | null; durationMs: number;
  outcome: 'answered' | 'refused' | 'failed'; code: string | null;
  promptTokens: number; cachedTokens: number; costUsd: number;
  tools: string[];
  agreement: { confirmation: boolean; sources: boolean } | null;
};

const TOOL_OF: Record<DeskEvent['type'], (e: any) => string> = {
  hold: () => 'place_hold', hold_refused: () => 'place_hold (refused after rules)',
  passage: () => 'read_home_rules', miss: () => 'read_home_rules (no passage)',
  call: e => e.status >= 400 ? `${e.tool} (${e.status})` : e.tool,
};
/** The tools that ran, in order, from what the tools themselves recorded (never the model's account). */
export const toolsRun = (dir: string, requestId: string) => eventsFor(dir, requestId).map(e => TOOL_OF[e.type](e));

export function writeReceipt(dir: string, receipt: Receipt) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'receipts.jsonl'), JSON.stringify(receipt) + '\n');
  return receipt;
}
