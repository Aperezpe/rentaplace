import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DB_PATH = process.env.RAP_DB || resolve(ROOT, 'data/rentaplace.db');
export const LOG_DIR = process.env.RAP_LOG_DIR || resolve(ROOT, 'logs');
export const OUTBOX_DIR = process.env.RAP_OUTBOX_DIR || resolve(ROOT, 'outbox');
export const PORT = Number(process.env.PORT || 5180);
export function today(): string {
  const value = process.env.RAP_TODAY || '2026-11-09';
  return value === 'now' ? new Date().toISOString().slice(0, 10) : value;
}
export function now(): string { return `${today()}T12:00:00.000Z`; }
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}
