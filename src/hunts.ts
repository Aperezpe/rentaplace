import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUNTS_DIR } from './hunter.ts';

/**
 * Cards for the Herdr Hunts widget, read from saved hunt reports. Read only, no model.
 * Each card: a short name, the request count, the replay line, then Fails / Still works / Neither with request numbers.
 */
export const ASK_MAIN = 'Read it and tell me what you would check first. Do not change any code yet.';
export type HuntCard = { id: string; title: string; detail: string; level: 'warn' | 'ok' | 'info'; report: string; file: string };

const cells = (row: string) => row.replace(/^\|\s*|\s*\|$/g, '').split(/\s*(?<!\\)\|\s*/).map(c => c.replace(/\\\|/g, '|'));

export function huntCard(id: string, markdown: string, file = ''): HuntCard {
  const rows = markdown.split('\n').filter(l => /^\| \d+ \|/.test(l)).map(cells).map(c => ({ n: Number(c[0]), request: c[2], status: c[c.length - 2], outcome: c[c.length - 1] }));
  if (!rows.length) {
    const event = markdown.match(/"event":"([^"]+)"/)?.[1] ?? 'event';
    return { id, title: `${event} · 0 requests · nothing to replay`, detail: 'Fails 0\nStill works 0\nNeither 0', level: 'info', report: markdown, file };
  }
  const [method, target] = rows[0].request.split(' ');
  const url = new URL(target, 'http://x');
  const slug = url.searchParams.get('slug') ?? rows[0].request.match(/"slug":"([^"]+)"/)?.[1];
  const name = `${method} ${url.pathname}${slug ? ` ${slug}` : ''}`;
  const replay = rows[0].outcome === 'failed' ? 'replay: same failure' : `replay: not the same failure (${rows[0].status}, ${rows[0].outcome})`;
  const list = (o: string) => { const ns = rows.filter(r => r.outcome === o).map(r => `#${r.n}`); return `${ns.length}${ns.length ? `: ${ns.join(', ')}` : ''}`; };
  return {
    id, file, report: markdown,
    title: `${name} · ${rows.length} requests · ${replay}`,
    detail: `Fails ${list('failed')}\nStill works ${list('worked')}\nNeither ${list('neither')}`,
    level: rows.some(r => r.outcome === 'failed') ? 'warn' : 'ok',
  };
}

export function huntCards(dir = HUNTS_DIR): HuntCard[] {
  const reports = join(dir, 'reports');
  if (!existsSync(reports)) return [];
  return readdirSync(reports).filter(f => f.endsWith('.md'))
    .map(f => ({ f, at: statSync(join(reports, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map(({ f }) => huntCard(f.replace(/\.md$/, ''), readFileSync(join(reports, f), 'utf8'), join(reports, f)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = huntCards();
  process.stdout.write(JSON.stringify({ summary: items.length ? `${items.length} hunt report${items.length === 1 ? '' : 's'}, newest first` : 'No hunt reports yet.', items }, null, 1) + '\n');
}
