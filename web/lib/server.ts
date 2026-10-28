import 'server-only';
import type { DatabaseSync } from 'node:sqlite';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { openDatabase, listingBySlug } from '../../src/db.ts';
import { verifySession } from '../../src/auth.ts';
import { AppError } from '../../src/errors.ts';
import { enabled } from '../../src/flags.ts';
import type { Account, Listing } from '../../src/types.ts';

const g = globalThis as typeof globalThis & { __rapDb?: DatabaseSync };

/** The app's one database connection, shared with the HTTP server that started the page renderer. */
export function db(): DatabaseSync {
  return (g.__rapDb ??= openDatabase());
}

export async function currentUser(): Promise<Account | undefined> {
  const value = (await cookies()).get('rap_session')?.value;
  const id = value ? verifySession(value) : undefined;
  return id ? (db().prepare('SELECT id,name,email,role FROM users WHERE id=?').get(id) as Account | undefined) : undefined;
}

/** Signed-in account of the given role; otherwise sends the person to demo sign-in, then back here. */
export async function requireRole(role: 'guest' | 'host', next: string): Promise<Account> {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (user.role !== role) redirect(`/signin?need=${role}&next=${encodeURIComponent(next)}`);
  return user;
}

/** True only when the HTTP server saw a loopback socket (it strips any client-sent marker). */
export async function isLocalRequest(): Promise<boolean> {
  return (await headers()).get('x-rap-local') === '1';
}

export function homeBySlug(slug: string): Listing {
  const home = listingBySlug(db(), slug);
  if (!home) notFound();
  return home;
}

export function flag(name: string): boolean {
  return enabled(db(), name);
}

/** Runs domain code; an AppError becomes a page-level problem instead of a crash. */
export function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: AppError } {
  try { return { ok: true, value: fn() }; }
  catch (error) {
    if (error instanceof AppError) {
      if (error.status === 404) notFound();
      return { ok: false, error };
    }
    throw error;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(params: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

export function toURLSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
    else if (value !== undefined) out.set(key, value);
  }
  return out;
}
