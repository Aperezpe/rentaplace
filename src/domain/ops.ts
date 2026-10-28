import type { DatabaseSync } from 'node:sqlite';
import { today } from '../config.ts';
export function stats(db:DatabaseSync) {
 const count=(table:string)=>(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
 return {listings:count('listings'),bookings:count('bookings'),users:count('users'),supportTickets:count('support_tickets'),feedback:count('feedback'),pendingReservations:(db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='pending'").get() as any).n};
}
export function health(db:DatabaseSync) {return {status:'ok',service:'rentaplace',node:process.version,today:today(),database:'connected',migrations:db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r:any)=>r.name)};}
