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
export const RESERVATION_REFERENCE=/\bRAP-[0-9A-F]{6,8}\b/i;
/**
 * The reservation a support ticket is about, for drafting a reply. Loopback only, read only.
 * Found by a reservation reference in the ticket, or the signed-in guest's only current or upcoming reservation.
 * A reference counts only when that reservation belongs to the ticket's guest (account or email).
 */
export function supportStay(db: DatabaseSync,ticketId: string,clock=now()) {
  const t:any=db.prepare('SELECT id,user_id,email,subject,message FROM support_tickets WHERE id=?').get(ticketId);
  if(!t)throw new AppError(404,'NOT_FOUND','Support ticket not found.');
  const select='SELECT b.*,l.title,l.slug,l.nightly_cents,l.weekend_cents FROM bookings b JOIN listings l ON b.listing_id=l.id';
  const ref=`${t.subject}\n${t.message}`.match(RESERVATION_REFERENCE)?.[0].toUpperCase();
  let b:any, via:'reference'|'account';
  if(ref) {
    b=db.prepare(`${select} WHERE b.reference=?`).get(ref);via='reference';
    if(!b)throw new AppError(404,'NO_RESERVATION',`The ticket names ${ref}, but no reservation has that reference.`);
    const mine=(t.user_id && b.guest_id===t.user_id) || String(b.guest_email).toLowerCase()===String(t.email).toLowerCase();
    if(!mine)throw new AppError(404,'NO_RESERVATION',`The ticket names ${ref}, but that reservation belongs to a different guest.`);
  } else {
    if(!t.user_id)throw new AppError(404,'NO_RESERVATION','No reservation reference in the ticket, and it was not sent from a signed-in account.');
    const current=db.prepare(`${select} WHERE b.guest_id=? AND b.status IN ('confirmed','pending') AND b.to_date>? ORDER BY b.from_date`).all(t.user_id,clock.slice(0,10)) as any[];
    if(current.length!==1)throw new AppError(404,'NO_RESERVATION',`No reservation reference in the ticket, and the guest has ${current.length} current or upcoming reservations.`);
    b=current[0];via='account';
  }
  return {via,reference:b.reference,home:b.title,slug:b.slug,from:b.from_date,to:b.to_date,nights:b.nights,guests:b.guests,status:b.status,
    datesHeld:['confirmed','pending'].includes(b.status),
    accommodationCents:b.accommodation_cents,cleaningCents:b.cleaning_cents,serviceFeeCents:b.service_fee_cents,taxCents:b.tax_cents,totalCents:b.total_cents,
    currentNightlyCents:b.nightly_cents,currentWeekendCents:b.weekend_cents};
}
