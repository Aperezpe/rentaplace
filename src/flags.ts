import type { DatabaseSync } from 'node:sqlite';
import { AppError, requireValue } from './errors.ts';
export function flags(db: DatabaseSync) { return db.prepare('SELECT name,enabled,description FROM flags ORDER BY name').all().map((r:any)=>({...r,enabled:!!r.enabled})); }
export function enabled(db: DatabaseSync,name: string) { return (db.prepare('SELECT enabled FROM flags WHERE name=?').get(name) as any)?.enabled===1; }
export function setFlag(db: DatabaseSync,name: string,value: unknown) {
  requireValue(typeof value==='boolean','Enabled must be true or false.');
  if(!db.prepare('SELECT name FROM flags WHERE name=?').get(name)) throw new AppError(404,'NOT_FOUND','Feature flag not found.');
  db.prepare('UPDATE flags SET enabled=? WHERE name=?').run(value?1:0,name);
  return {name,enabled:value};
}
