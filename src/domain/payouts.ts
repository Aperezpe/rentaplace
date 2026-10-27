import type { DatabaseSync } from 'node:sqlite';
import { addDays } from '../config.ts';
import { log } from '../log.ts';
export function schedulePayout(db: DatabaseSync,booking: any,hostId: string) {
  const id=`payout-${booking.id}`,date=addDays(booking.from_date,1);
  db.prepare('INSERT INTO payouts (id,booking_id,host_id,amount_cents,scheduled_date,status) VALUES (?,?,?,?,?,?)').run(id,booking.id,hostId,booking.host_payout_cents,date,'scheduled');
  return {id,bookingId:booking.id,hostId,amountCents:booking.host_payout_cents,scheduledDate:date};
}
export function hostPayouts(db: DatabaseSync,hostId: string) {
  const items=db.prepare('SELECT p.*,b.reference,l.title,l.slug FROM payouts p JOIN bookings b ON p.booking_id=b.id JOIN listings l ON b.listing_id=l.id WHERE p.host_id=? ORDER BY p.scheduled_date DESC').all(hostId) as any[];
  return {items,scheduledCents:items.filter(p=>p.status==='scheduled').reduce((n,p)=>n+p.amount_cents,0),paidCents:items.filter(p=>p.status==='paid').reduce((n,p)=>n+p.amount_cents,0)};
}
export function payoutsCsv(items: any[]) {
  const cell=(v: unknown)=>`"${String(v ?? '').replaceAll('"','""')}"`;
  return ['Reference,Home,Scheduled date,Paid date,Status,Amount (USD)',...items.map(p=>[p.reference,p.title,p.scheduled_date,p.paid_date,p.status,(p.amount_cents/100).toFixed(2)].map(cell).join(','))].join('\r\n')+'\r\n';
}
