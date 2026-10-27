import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { textInput, requireValue, AppError } from '../errors.ts';
import { now } from '../config.ts';
import { enabled } from '../flags.ts';
import type { Account } from '../types.ts';
export function createFeedback(db: DatabaseSync,input: any,user?: Account) {
  if(!enabled(db,'guest_feedback'))throw new AppError(503,'FEEDBACK_PAUSED','Feedback is temporarily paused.');
  const page=textInput(input.page,'Page',500),text=textInput(input.text,'Feedback',2000),rating=String(input.rating || 'good');
  requireValue(page.startsWith('/')&&!page.startsWith('//'),'Choose a page within RentAPlace.');
  requireValue(['good','needs-work'].includes(rating),'Choose a page rating.');
  const id=randomUUID(),createdAt=now();
  db.prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?)').run(id,user?.id || null,page,rating,text,createdAt);
  return {id,page,rating,text,createdAt};
}
