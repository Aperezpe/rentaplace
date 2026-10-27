import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { DB_PATH, now } from './config.ts';
import { AppError } from './errors.ts';
import type { Account } from './types.ts';
let key: string | undefined;
function secret() {
  if(key) return key;
  if(process.env.RAP_SESSION_SECRET) return key=process.env.RAP_SESSION_SECRET;
  const path=join(dirname(DB_PATH),'session.key');
  mkdirSync(dirname(path),{recursive:true});
  if(!existsSync(path)) writeFileSync(path,randomBytes(32).toString('hex'),{mode:0o600});
  return key=readFileSync(path,'utf8').trim();
}
export function makeSession(id: string) {
  const expiry=Date.parse(now())+7*86400000;
  const payload=Buffer.from(JSON.stringify({id,expiry})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret()).update(payload).digest('base64url')}`;
}
export function verifySession(value: string): string | undefined {
  try {
    const [payload,signature,...rest]=value.split('.');
    if(!payload || !signature || rest.length || value.length>1024)return;
    const expected=createHmac('sha256',secret()).update(payload).digest();
    const actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(typeof data.id!=='string' || data.expiry<=Date.parse(now()))return;
    return data.id;
  } catch{return;}
}
export function sessionUser(req: IncomingMessage,db: DatabaseSync): Account | undefined {
  const value=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('rap_session='))?.slice(12);
  const id=value?verifySession(value):undefined;
  return id?db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(id) as Account | undefined:undefined;
}
export function signIn(db: DatabaseSync,id: string,res: ServerResponse): Account {
  const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(id) as Account | undefined;
  if(!user)throw new AppError(400,'UNKNOWN_ACCOUNT','Choose an available demo account.');
  res.setHeader('Set-Cookie',`rap_session=${makeSession(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  return user;
}
export function signOut(res: ServerResponse) {res.setHeader('Set-Cookie','rap_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');}
export function requireUser(user: Account | undefined,role?: 'guest' | 'host'): Account {
  if(!user)throw new AppError(401,'SIGN_IN_REQUIRED','Please use demo sign-in to continue.');
  if(role && user.role!==role)throw new AppError(403,'WRONG_ACCOUNT',`Choose a ${role} demo account to continue.`);
  return user;
}
export function safeNext(value: unknown): string {return typeof value==='string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\\\r\n]/.test(value)?value:'/';}
export function localOnly(req: IncomingMessage) {
  const ip=req.socket.remoteAddress;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip || ''))throw new AppError(403,'LOCAL_ONLY','This page is only available from this computer.');
}
