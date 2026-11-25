import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ROOT, WATCHER_DIR } from './config.ts';
import { tagsPath, type Tag } from './sorter.ts';
import { DRAFTS_DIR, draftPath } from './drafts.ts';

/**
 * Rows for the Herdr Issues widget: every support ticket joined to its sorter tag by ticketId.
 * Read only, no model. A ticket without a tag is "not sorted", never "nobody".
 */
export type IssueRow = { id: string; title: string; detail: string; level: 'warn' | 'info' | 'ok'; state: 'waiting' | 'not sorted' | 'sorted'; owner: string | null; draft_file?: string };

export function loadTags(dir: string = WATCHER_DIR): Map<string, Tag> {
  const tags = new Map<string, Tag>();
  if (!existsSync(tagsPath(dir))) return tags;
  for (const line of readFileSync(tagsPath(dir), 'utf8').split('\n')) {
    try { const tag = JSON.parse(line); if (typeof tag?.ticketId === 'string' && !tags.has(tag.ticketId)) tags.set(tag.ticketId, tag); } catch {}
  }
  return tags;
}

export function issueRows(dbPath: string = DB_PATH, dir: string = WATCHER_DIR, draftsDir: string = DRAFTS_DIR): IssueRow[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let tickets: { id: string; subject: string }[];
  try { tickets = db.prepare('SELECT id, subject FROM support_tickets ORDER BY created_at DESC, rowid DESC').all() as any; }
  finally { db.close(); }
  const tags = loadTags(dir);
  const rows = tickets.map((t): IssueRow => {
    const tag = tags.get(t.id);
    if (!tag) return { id: t.id, title: `not sorted · ${t.subject}`, detail: t.id, level: 'info', state: 'not sorted', owner: null };
    const waiting = tag.money === true || tag.unsure === true;
    const flags = [tag.money ? 'money' : null, tag.unsure ? 'unsure' : null].filter(Boolean).join(', ');
    return {
      id: t.id, owner: tag.owner, state: waiting ? 'waiting' : 'sorted', level: waiting ? 'warn' : 'ok',
      title: `${tag.owner} · ${t.subject}`,
      detail: waiting ? `${t.id} · ${flags} · ${tag.why.join(' · ')}` : t.id,
    };
  });
  // A saved draft is only pointed to (relative to the project when inside it); the panel reads it when the ticket is selected, so rows never carry the guest's message.
  for (const row of rows) { const file = draftPath(row.id, draftsDir); if (existsSync(file)) { const rel = relative(ROOT, file); row.draft_file = rel.startsWith('..') ? file : rel; row.title += ' · draft'; } }
  const rank = { waiting: 0, 'not sorted': 1, sorted: 2 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = issueRows();
  const count = (s: IssueRow['state']) => items.filter(i => i.state === s).length;
  process.stdout.write(JSON.stringify({ summary: `${count('waiting')} waiting for a person, ${count('not sorted')} not sorted, ${count('sorted')} sorted`, items }, null, 1) + '\n');
}
