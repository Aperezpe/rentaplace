import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.ts';

/** Jev (TypeSafe System One). One copy of the questions and the decide rule, shared by the sorter and sorter/trial.mjs. */
export const JEV = { name: 'jev', model: 'jev-latest', endpoint: process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone' };
export const USD_PER_INPUT_TOKEN = 42 / 1e9; // docs.typesafe.ai/models: $42 per billion input tokens, output free

export const MONEY_P = 0.30;
export const SURE_P = 0.70;
export const SURE_OWNER = 0.70;

export const QUESTIONS = {
  owner: {
    type: 'choice',
    instructions: 'Which team owns this support ticket?',
    criteria: {
      booking: 'The reservation itself: dates, status, confirmation, arrival, host accept or decline, checkout.',
      pricing: 'What a guest pays, what is refunded, what a host receives: prices, fees, tax, refunds, payouts.',
      nobody: 'Anything else. Choose this rather than stretch a team to fit.',
    },
  },
  money: {
    type: 'noul',
    instructions: 'Is this ticket about money moving or owed: a refund, a charge, a payout, a price or total, compensation, a deposit? A ticket that only contains a money-sounding word is not.',
  },
};

export type Owner = 'booking' | 'pricing' | 'nobody';
export type ChoiceAnswer = { choice: Owner; confidence: number; probabilities?: Record<string, number> };
export type Decision = { owner: Owner; money: boolean; unsure: boolean; why: string[]; moneyP: number; ownerConfidence: number; ownerProbabilities?: Record<string, number> };

function apiKey(): string {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  let text = '';
  try { text = readFileSync(join(ROOT, '.env'), 'utf8'); } catch {}
  const line = text.split('\n').find(l => l.startsWith('TYPESAFE_API_KEY='));
  const key = line?.slice('TYPESAFE_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('TYPESAFE_API_KEY is missing from .env');
  return key;
}

/** The decision rule, in code. `why` names every threshold that set money or unsure. */
export function decide(ownerAnswer: ChoiceAnswer, moneyP: number): Decision {
  const ownerConfidence = ownerAnswer.confidence;
  const money = moneyP >= MONEY_P;
  const moneyUnsure = money && moneyP < SURE_P, ownerUnsure = ownerConfidence < SURE_OWNER;
  const why = [
    money ? `money: moneyP ${moneyP} >= ${MONEY_P}` : `no money: moneyP ${moneyP} < ${MONEY_P}`,
    `owner ${ownerAnswer.choice} at confidence ${ownerConfidence}`,
    ...(moneyUnsure ? [`unsure: moneyP ${moneyP} is between ${MONEY_P} and ${SURE_P}`] : []),
    ...(ownerUnsure ? [`unsure: owner confidence ${ownerConfidence} < ${SURE_OWNER}`] : []),
  ];
  return { owner: ownerAnswer.choice, money, unsure: moneyUnsure || ownerUnsure, why, moneyP, ownerConfidence, ownerProbabilities: ownerAnswer.probabilities };
}

export type JevCall = { ok: boolean; status: number | null; ms: number; attempts: number; error?: string; modelReported?: string; usage?: { input_tokens: number; output_tokens: number }; costUsd?: number; raw?: any };

/** One request with both questions. Retries 429/529/network only, with backoff; a bad answer is never retried. */
export async function callJev(ticket: { subject: string; message: string }, { retries = 4 } = {}): Promise<JevCall> {
  const body = JSON.stringify({ model: JEV.model, state: { subject: ticket.subject, message: ticket.message }, questions: QUESTIONS });
  let attempts = 0, last: JevCall = { ok: false, status: null, ms: 0, attempts: 0 };
  while (attempts <= retries) {
    attempts++;
    const started = performance.now();
    try {
      const res = await fetch(JEV.endpoint, { method: 'POST', headers: { authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
      const ms = Math.round(performance.now() - started);
      const text = await res.text();
      if (res.status === 429 || res.status === 529) { last = { ok: false, status: res.status, ms, attempts, error: text.slice(0, 300) }; await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) * 1000) || 500 * 2 ** attempts)); continue; }
      if (!res.ok) return { ok: false, status: res.status, ms, attempts, error: text.slice(0, 500) };
      const data = JSON.parse(text);
      return { ok: true, status: res.status, ms, attempts, modelReported: data.model, usage: data.usage, costUsd: (data.usage?.input_tokens || 0) * USD_PER_INPUT_TOKEN, raw: data.answers };
    } catch (error: any) {
      if (/TYPESAFE_API_KEY/.test(String(error?.message))) return { ok: false, status: null, ms: 0, attempts, error: error.message };
      last = { ok: false, status: null, ms: Math.round(performance.now() - started), attempts, error: String(error?.message || error) };
      if (attempts <= retries) await new Promise(r => setTimeout(r, 500 * 2 ** attempts));
    }
  }
  return last;
}

/** Strict: both answers present with the right types and ranges, else invalid (a miss, never money=false). */
export function parseJev(raw: any): ({ valid: true } & Decision) | { valid: false; reason: string } {
  const o = raw?.owner, m = raw?.money;
  if (!o || o.type !== 'choice' || !['booking', 'pricing', 'nobody'].includes(o.choice) || typeof o.confidence !== 'number') return { valid: false, reason: `owner ${JSON.stringify(o)?.slice(0, 120)}` };
  if (!m || m.type !== 'noul' || typeof m.noul !== 'number' || m.noul < 0 || m.noul > 1) return { valid: false, reason: `money ${JSON.stringify(m)?.slice(0, 120)}` };
  return { valid: true, ...decide(o, m.noul) };
}
