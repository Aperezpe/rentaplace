import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { ROOT } from './config.ts';

export type Pages = {
  mode: 'development' | 'production';
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

/**
 * Starts the Next.js page renderer (app/ and web/) inside this process and shares the open database with it.
 * RAP_PAGES=off skips it, leaving only the JSON API and form routes.
 */
export async function startPages(db: DatabaseSync, port: number): Promise<Pages | undefined> {
  if (process.env.RAP_PAGES === 'off') return undefined;
  (globalThis as { __rapDb?: DatabaseSync }).__rapDb = db;
  const dev = process.env.NODE_ENV !== 'production';
  const { default: next } = await import('next');
  const app = next({ dev, dir: ROOT, hostname: '127.0.0.1', port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();
  return {
    mode: dev ? 'development' : 'production',
    handle: (req, res) => handle(req, res),
    upgrade: (req, socket, head) => { void upgrade(req, socket, head); },
  };
}
