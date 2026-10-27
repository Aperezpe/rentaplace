import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { textInput, emailInput, AppError } from '../errors.ts';
import { now } from '../config.ts';
import { log } from '../log.ts';
import { enabled } from '../flags.ts';
import type { Account } from '../types.ts';
export function createTicket(db: DatabaseSync,input: any,user?: Account) {
  if(!enabled(db,'support_form'))throw new AppError(503,'SUPPORT_PAUSED','New support requests are temporarily paused. Please try again shortly.');
  const id=randomUUID(),name=textInput(input.name || user?.name,'Name',100),email=emailInput(input.email || user?.email),subject=textInput(input.subject,'Subject',160),message=textInput(input.message,'Message',5000),createdAt=now();
  db.prepare('INSERT INTO support_tickets VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,user?.id || null,name,email,subject,message,'uncategorized',null,'open',createdAt);
  log('support.received',{ticketId:id});return {id,subject,category:'uncategorized',status:'open',ownerId:null,createdAt};
}
export function tickets(db: DatabaseSync) {return db.prepare('SELECT * FROM support_tickets ORDER BY created_at DESC,rowid DESC').all();}
