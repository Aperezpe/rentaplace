import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR, now } from './config.ts';
export function log(event: string, detail: Record<string, unknown> = {}) {
  const entry={time:now(),event,...detail};
  const line=JSON.stringify(entry);
  process.stdout.write(line+'\n');
  mkdirSync(LOG_DIR,{recursive:true});
  appendFileSync(join(LOG_DIR,'app.log'),line+'\n');
  return entry;
}
export function readLogs(options: {slow?:boolean;errors?:boolean;limit?:number}={}) {
  const path=join(LOG_DIR,'app.log');
  if(!existsSync(path)) return [];
  return readFileSync(path,'utf8').trim().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}})
    .filter(row=>(!options.slow || row.ms>=200) && (!options.errors || row.status>=400 || row.event.endsWith('.failed'))).slice(-(options.limit || 100)).reverse();
}
