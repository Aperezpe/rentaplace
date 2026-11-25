import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from './config.ts';
// Log time is the real clock so new lines stand out; business dates still come from RAP_TODAY.
export function log(event: string, detail: Record<string, unknown> = {}) {
  const entry={time:new Date().toISOString(),event,...detail};
  const line=JSON.stringify(entry);
  if(process.env.RAP_LOG_STDOUT!=='0')process.stdout.write(line+'\n');
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

/**
 * Fields a failed request may log so it can be replayed: home, dates, guests, search and flag values.
 * Anything not listed (email, name, message, card number, free text) is never logged.
 */
export const REPLAY_FIELDS=['slug','from','to','guests','month','place','page','limit','sort','bedrooms','instant','minPrice','maxPrice','action','enabled','status'];
export function replayFields(source: Record<string, unknown> | URLSearchParams | undefined) {
  if(!source)return undefined;
  const get=(k:string)=>source instanceof URLSearchParams?source.get(k):(source as any)[k];
  const out:Record<string,string|number|boolean>={};
  for(const key of REPLAY_FIELDS){const v=get(key);if(typeof v==='number' || typeof v==='boolean')out[key]=v;else if(typeof v==='string' && v!=='')out[key]=v.slice(0,100);}
  return Object.keys(out).length?out:undefined;
}
