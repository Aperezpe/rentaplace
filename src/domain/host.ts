import type { DatabaseSync } from 'node:sqlite';
import { requireUser } from '../auth.ts';
import { today, addDays } from '../config.ts';
import { monthDates } from './calendar.ts';
import type { Account } from '../types.ts';
export function reservations(db: DatabaseSync,user: Account | undefined) {
  const account=requireUser(user,'host');
  return db.prepare('SELECT b.*,l.title,l.slug FROM bookings b JOIN listings l ON b.listing_id=l.id WHERE l.host_id=? ORDER BY CASE WHEN b.status=\'pending\' THEN 0 ELSE 1 END,b.from_date DESC').all(account.id);
}
export function dashboard(db: DatabaseSync,user: Account | undefined) {
  const account=requireUser(user,'host'),day=today(),month=day.slice(0,7),dates=monthDates(month),end=addDays(dates.at(-1)!,1);
  const homes:any=db.prepare('SELECT COUNT(*) count, SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) active FROM listings WHERE host_id=?').get(account.id);
  const booked:any=db.prepare("SELECT COALESCE(SUM(julianday(MIN(b.to_date,?))-julianday(MAX(b.from_date,?))),0) nights FROM bookings b JOIN listings l ON b.listing_id=l.id WHERE l.host_id=? AND l.status='active' AND b.from_date<? AND b.to_date>? AND b.status IN ('confirmed','completed')").get(end,dates[0],account.id,end,dates[0]);
  const earnings:any=db.prepare("SELECT COALESCE(SUM(amount_cents),0) cents FROM payouts WHERE host_id=? AND scheduled_date>=? AND scheduled_date<? AND status IN ('paid','scheduled')").get(account.id,dates[0],end);
  const upcoming=db.prepare("SELECT b.*,l.title,l.slug FROM bookings b JOIN listings l ON b.listing_id=l.id WHERE l.host_id=? AND b.from_date>=? AND b.from_date<? AND b.status IN ('confirmed','pending') ORDER BY b.from_date LIMIT 12").all(account.id,day,addDays(day,7));
  const pending:any=db.prepare("SELECT COUNT(*) count FROM bookings b JOIN listings l ON b.listing_id=l.id WHERE l.host_id=? AND b.status='pending'").get(account.id);
  return {month,today:day,listingCount:homes.count,activeListings:homes.active || 0,occupancyPercent:homes.active?Math.round(booked.nights/(homes.active*dates.length)*100):0,bookedNights:booked.nights,earningsCents:earnings.cents,pendingRequests:pending.count,upcoming};
}
