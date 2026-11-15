import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, quote } from '../src/domain/bookings.ts';
import { placeHold, readHold, guestHolds, releaseHold, expireHolds, HOLD_HOURS } from '../src/domain/holds.ts';
import { blockDates, listingCalendar } from '../src/domain/calendar.ts';
import { search, parseSearch } from '../src/domain/search.ts';
import { createApp } from '../src/server.ts';
import { makeSession } from '../src/auth.ts';
import { fixture, guest, otherGuest, host, input } from './helpers.ts';
// A hold is a 24-hour claim on a stay: it keeps the nights, locks the quoted price, moves no money and expires.
// Every time-dependent rule takes the clock as an argument, so nothing here waits.
const stay={slug:input.slug,from:input.from,to:input.to,guests:2};
const T0='2026-11-09T12:00:00.000Z',JUST_BEFORE='2026-11-10T11:59:59.000Z',T24='2026-11-10T12:00:00.000Z';
const count=(db:any,table:string)=>(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
test('placing a hold needs a signed-in guest and moves no money',()=>{
 const {db}=fixture();
 assert.throws(()=>placeHold(db,stay,undefined,T0),{status:401});assert.throws(()=>placeHold(db,stay,host,T0),{status:403});assert.equal(count(db,'holds'),0);
 const {hold,replayed}=placeHold(db,stay,guest,T0);
 assert.equal(replayed,false);assert.equal(hold.status,'active');assert.equal(hold.guest_id,guest.id);assert.equal(hold.expires_at,T24);assert.equal(HOLD_HOURS,24);assert.match(hold.reference,/^HOLD-[0-9A-F]{8}$/);
 for(const table of ['bookings','payouts','email_outbox'])assert.equal(count(db,table),0,`${table} stays empty`);
 assert.ok(!('cardNumber' in hold)&&!('payment_status' in hold));db.close();
});
test('held nights are not quoted or reserved by anyone else, and a host cannot block them',()=>{
 const {db}=fixture();placeHold(db,stay,guest,T0);
 assert.throws(()=>quote(db,stay.slug,stay.from,stay.to,2,undefined,T0),{code:'DATES_UNAVAILABLE'});
 assert.throws(()=>quote(db,stay.slug,stay.from,stay.to,2,otherGuest,T0),{code:'DATES_UNAVAILABLE'});
 assert.throws(()=>quote(db,stay.slug,'2026-11-12','2026-11-14',2,otherGuest,T0),{code:'DATES_UNAVAILABLE'},'an overlapping stay is refused too');
 assert.throws(()=>createBooking(db,input,otherGuest,T0),{code:'DATES_UNAVAILABLE'});
 assert.throws(()=>placeHold(db,stay,otherGuest,T0),{code:'DATES_UNAVAILABLE'});
 assert.throws(()=>blockDates(db,host,{...stay,reason:'Repairs'},T0),{status:409});
 assert.equal(count(db,'bookings'),0);assert.equal(count(db,'blocks'),0);assert.equal(count(db,'holds'),1);
 assert.ok(quote(db,stay.slug,'2026-11-13','2026-11-15',2,otherGuest,T0),'checkout day is free for the next stay');db.close();
});
test('a hold locks the price quoted when it was placed, also when its guest reserves',()=>{
 const {db}=fixture();const quoted=quote(db,stay.slug,stay.from,stay.to,2,guest,T0);const {hold}=placeHold(db,stay,guest,T0);
 assert.equal(hold.total_cents,quoted.totalCents);assert.deepEqual(hold.quote,quoted);
 db.prepare('UPDATE listings SET nightly_cents=nightly_cents*2,weekend_cents=weekend_cents*2 WHERE slug=?').run(stay.slug);
 assert.equal(readHold(db,hold.id,guest,T0).total_cents,quoted.totalCents);
 assert.equal(quote(db,stay.slug,stay.from,stay.to,2,guest,T0).totalCents,quoted.totalCents,'the holder is quoted the held price');
 assert.ok(quote(db,stay.slug,'2026-12-01','2026-12-04',2,guest,T0).totalCents>quoted.totalCents,'new quotes use the new prices');
 const {booking}=createBooking(db,input,guest,T0);
 assert.equal(booking.total_cents,quoted.totalCents);assert.equal(booking.accommodation_cents,quoted.accommodationCents);assert.equal(booking.host_payout_cents,quoted.hostPayoutCents);
 const after=readHold(db,hold.id,guest,T0);assert.equal(after.status,'converted');assert.equal(after.booking_id,booking.id);db.close();
});
test('one hold per guest and stay: a second request is refused, also after release',()=>{
 const {db}=fixture();const {hold}=placeHold(db,stay,guest,T0);
 assert.throws(()=>placeHold(db,stay,guest,T0),{code:'HOLD_EXISTS'});
 releaseHold(db,hold.id,guest,T0);assert.throws(()=>placeHold(db,stay,guest,T0),{code:'HOLD_EXISTS'});
 assert.equal(count(db,'holds'),1);db.close();
});
test('a repeated request with the same request key places one hold; a different request under that key is refused',()=>{
 const {db}=fixture(),request={...stay,requestKey:'desk-request-1'};
 const a=placeHold(db,request,guest,T0),b=placeHold(db,request,guest,T0);
 assert.equal(a.hold.id,b.hold.id);assert.equal(b.replayed,true);assert.equal(count(db,'holds'),1);
 assert.throws(()=>placeHold(db,{...request,to:'2026-11-14'},guest,T0),{code:'REQUEST_CONFLICT'});
 assert.throws(()=>placeHold(db,request,otherGuest,T0),{code:'REQUEST_CONFLICT'});
 assert.equal(placeHold(db,request,guest,T24).hold.status,'expired','a retry after the hold ran out reports it, and places nothing new');assert.equal(count(db,'holds'),1);db.close();
});
test('a hold expires 24 hours after it was placed, by the clock passed in',()=>{
 const {db}=fixture();const {hold}=placeHold(db,stay,guest,T0);
 assert.equal(readHold(db,hold.id,guest,JUST_BEFORE).status,'active');
 assert.throws(()=>createBooking(db,input,otherGuest,JUST_BEFORE),{code:'DATES_UNAVAILABLE'});
 assert.equal(readHold(db,hold.id,guest,T24).status,'expired');
 assert.ok(quote(db,stay.slug,stay.from,stay.to,2,otherGuest,T24),'the nights are free again without anyone releasing them');
 assert.equal(expireHolds(db,T24),1);assert.equal((db.prepare('SELECT status FROM holds WHERE id=?').get(hold.id) as any).status,'expired');
 const {booking}=createBooking(db,input,otherGuest,T24);assert.equal(booking.guest_id,otherGuest.id);db.close();
});
test('an expired hold no longer locks the price for its guest',()=>{
 const {db}=fixture();const {hold}=placeHold(db,stay,guest,T0);
 db.prepare('UPDATE listings SET nightly_cents=nightly_cents*2,weekend_cents=weekend_cents*2 WHERE slug=?').run(stay.slug);
 const {booking}=createBooking(db,input,guest,T24);assert.ok(booking.total_cents>hold.total_cents);assert.equal(readHold(db,hold.id,guest,T24).status,'expired');db.close();
});
test('releasing a hold frees the nights; only its guest can read or release it',()=>{
 const {db}=fixture();const {hold}=placeHold(db,stay,guest,T0);
 assert.throws(()=>readHold(db,hold.id,otherGuest,T0),{status:404});assert.throws(()=>releaseHold(db,hold.id,otherGuest,T0),{status:404});
 assert.equal(guestHolds(db,guest,T0).length,1);assert.equal(guestHolds(db,otherGuest,T0).length,0);
 const released=releaseHold(db,hold.id,guest,T0);assert.equal(released.status,'released');assert.equal(releaseHold(db,hold.id,guest,T0).status,'released');
 assert.ok(quote(db,stay.slug,stay.from,stay.to,2,otherGuest,T0));db.close();
});
test('a hold cannot take nights a reservation or a block already holds, or a home that is not active',()=>{
 const {db}=fixture();createBooking(db,input,otherGuest,T0);assert.throws(()=>placeHold(db,stay,guest,T0),{code:'DATES_UNAVAILABLE'});
 blockDates(db,host,{slug:stay.slug,from:'2026-11-20',to:'2026-11-22'},T0);assert.throws(()=>placeHold(db,{...stay,from:'2026-11-21',to:'2026-11-23'},guest,T0),{code:'DATES_UNAVAILABLE'});
 db.prepare("UPDATE listings SET status='closed' WHERE slug='fern-cottage'").run();assert.throws(()=>placeHold(db,{...stay,slug:'fern-cottage'},guest,T0),{code:'HOME_NOT_OPEN'});
 assert.throws(()=>placeHold(db,{...stay,from:'2026-10-01',to:'2026-10-03'},guest,T0),{status:400});assert.equal(count(db,'holds'),0);db.close();
});
test('search and the calendar show held nights as taken while the hold is active',()=>{
 const {db,home}=fixture();placeHold(db,stay,guest);
 const q=parseSearch(new URLSearchParams({from:stay.from,to:stay.to}));
 assert.ok(!search(db,q).items.some(h=>h.slug===stay.slug));
 assert.equal(listingCalendar(db,home,'2026-11').days.find(d=>d.date==='2026-11-11')?.status,'held');
 assert.equal(listingCalendar(db,home,'2026-11',false,T24).days.find(d=>d.date==='2026-11-11')?.status,'available');
 assert.ok(search(db,q,T24).items.some(h=>h.slug===stay.slug));db.close();
});
// End to end through the HTTP API on a running copy, with a control: without the hold the same nights are bookable.
test('HTTP: a signed-in guest holds a stay, another guest cannot reserve it, and without the hold the same nights are bookable',async()=>{
 const run=async(withHold:boolean)=>{
  const {db}=fixture();const {server}=createApp(db);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const call=async(who:string|null,method:string,path:string,body?:unknown)=>{const res=await fetch(base+path,{method,headers:{...(who?{Cookie:`rap_session=${makeSession(who)}`}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json() as any};};
  try {
   const before=await call(null,'GET',`/api/quote?slug=${stay.slug}&from=${stay.from}&to=${stay.to}&guests=2`);assert.equal(before.status,200);
   let hold:any;
   if(withHold) {
    assert.equal((await call(null,'POST','/api/holds',stay)).status,401,'no sign-in, no hold');
    const placed=await call(guest.id,'POST','/api/holds',{...stay,requestKey:'http-1'});assert.equal(placed.status,201);hold=placed.data.hold;
    assert.equal(hold.total_cents,before.data.totalCents);assert.equal(hold.status,'active');
    const again=await call(guest.id,'POST','/api/holds',{...stay,requestKey:'http-1'});assert.equal(again.status,200);assert.equal(again.data.hold.id,hold.id);assert.equal(again.data.replayed,true);
    assert.equal((await call(guest.id,'GET',`/api/holds/${hold.id}`)).data.hold.reference,hold.reference);
    assert.equal((await call(otherGuest.id,'GET',`/api/holds/${hold.id}`)).status,404);
    assert.equal((await call(guest.id,'GET','/api/holds')).data.items.length,1);
   }
   const quoteNow=await call(otherGuest.id,'GET',`/api/quote?slug=${stay.slug}&from=${stay.from}&to=${stay.to}&guests=2`);
   const book=await call(otherGuest.id,'POST','/api/bookings',input);
   if(withHold) {
    assert.equal(quoteNow.status,409);assert.equal(quoteNow.data.error.code,'DATES_UNAVAILABLE');assert.equal(book.status,409);assert.equal(book.data.error.code,'DATES_UNAVAILABLE');
    for(const table of ['bookings','payouts','email_outbox'])assert.equal(count(db,table),0,`${table} stays empty`);
    const released=await call(guest.id,'POST',`/api/holds/${hold.id}/release`);assert.equal(released.data.hold.status,'released');
    assert.equal((await call(otherGuest.id,'POST','/api/bookings',input)).status,201,'released nights can be reserved');
   } else {assert.equal(quoteNow.status,200);assert.equal(book.status,201);assert.equal(count(db,'holds'),0);}
  } finally {await new Promise(r=>server.close(r));db.close();}
 };
 await run(false);await run(true);
});
