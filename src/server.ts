import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { bootstrap } from './bootstrap.ts';
import { Router, html, json, redirect, readBody } from './router.ts';
import type { Context } from './router.ts';
import { ROOT, PORT, today } from './config.ts';
import { sessionUser, signIn, signOut, safeNext, requireUser, localOnly } from './auth.ts';
import { AppError, integer, requireValue } from './errors.ts';
import { log, readLogs } from './log.ts';
import { search, parseSearch } from './domain/search.ts';
import { listingBySlug } from './db.ts';
import { quote, createBooking, guestBookings, guestBooking, cancelBooking, respondToReservation, flushOutbox } from './domain/bookings.ts';
import { hostListings, ownedListing, saveListing } from './domain/listings.ts';
import { hostCalendar, listingCalendar, blockDates, unblockDates } from './domain/calendar.ts';
import { dashboard, reservations } from './domain/host.ts';
import { hostPayouts, payoutsCsv } from './domain/payouts.ts';
import { createTicket, tickets } from './domain/support.ts';
import { createFeedback } from './domain/feedback.ts';
import { flags, setFlag } from './flags.ts';
import { homePage, searchPage, detailPage, checkoutPage, confirmationPage, tripsPage, helpPage, signInPage, cancelPage } from './pages/guest.ts';
import { hostHomePage, hostListingsPage, listingEditorPage, hostCalendarPage, hostReservationsPage, hostPayoutsPage } from './pages/host.ts';
import { adminPage, stats, health } from './pages/admin.ts';
import { errorPage } from './pages/layout.ts';
import { openapi } from './openapi.ts';

export function createApp(db: DatabaseSync = bootstrap()) {
 const router=new Router();
 const home=(slug:string)=>{const h=listingBySlug(db,slug);if(!h)throw new AppError(404,'NOT_FOUND','We could not find that home.');return h;};
 const host=(ctx:Context)=>requireUser(ctx.user,'host');
 const api=(method:string,path:string,fn:(c:Context)=>unknown)=>router.on(method,path,fn);
 const sendCsv=(ctx:Context)=>{const data=hostPayouts(db,host(ctx).id);ctx.res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="rentaplace-payouts.csv"'});ctx.res.end(payoutsCsv(data.items));};
 api('GET','/api/health',()=>health(db));
 api('GET','/api/openapi.json',()=>openapi);
 api('GET','/api/stats',ctx=>{localOnly(ctx.req);return stats(db);});
 api('GET','/api/home',()=>({featured:['lakeside-a-frame','pine-hollow-cabin','red-rock-casita','old-mill-loft'].map(home),regions:db.prepare('SELECT * FROM regions ORDER BY name').all()}));
 api('GET','/api/regions',()=>({items:db.prepare('SELECT * FROM regions ORDER BY name').all()}));
 api('GET','/api/session',ctx=>({user:ctx.user || null}));
 api('GET','/api/auth/accounts',()=>({items:db.prepare("SELECT id,name,role FROM users WHERE id IN ('guest-1','guest-2','host-1','host-5','host-6') ORDER BY role,id").all()}));
 api('POST','/api/auth/signin',ctx=>({user:signIn(db,String(ctx.body.userId),ctx.res)}));
 api('POST','/api/auth/signout',ctx=>{signOut(ctx.res);return {signedOut:true};});
 api('GET','/api/listings',ctx=>{const result=search(db,parseSearch(ctx.url.searchParams));ctx.res.setHeader('Server-Timing',`search;dur=${result.searchMs}`);return result;});
 api('GET','/api/listings/:slug',ctx=>{const h=home(ctx.params.slug);return {home:h,host:db.prepare('SELECT id,name FROM users WHERE id=?').get(h.host_id),reviews:db.prepare('SELECT rating,text,created_at FROM reviews WHERE listing_id=? ORDER BY created_at DESC LIMIT 20').all(h.id),calendar:listingCalendar(db,h,ctx.url.searchParams.get('month') || today().slice(0,7))};});
 api('GET','/api/quote',ctx=>quote(db,ctx.url.searchParams.get('slug') || '',ctx.url.searchParams.get('from') || '',ctx.url.searchParams.get('to') || '',integer(ctx.url.searchParams.get('guests') || 2,'Guests',1,20)));
 api('GET','/api/bookings',ctx=>({items:guestBookings(db,ctx.user)}));
 api('POST','/api/bookings',ctx=>{const result=createBooking(db,ctx.body,ctx.user);json(ctx.res,result,result.replayed?200:201);});
 api('GET','/api/bookings/:id',ctx=>({booking:guestBooking(db,ctx.params.id,ctx.user)}));
 api('POST','/api/bookings/:id/cancel',ctx=>({booking:cancelBooking(db,ctx.params.id,ctx.user)}));
 api('GET','/api/host/dashboard',ctx=>dashboard(db,ctx.user));
 api('GET','/api/host/listings',ctx=>({items:hostListings(db,ctx.user)}));
 api('POST','/api/host/listings',ctx=>json(ctx.res,{home:saveListing(db,ctx.body,ctx.user)},201));
 api('GET','/api/host/listings/:slug',ctx=>({home:ownedListing(db,ctx.params.slug,ctx.user)}));
 api('PATCH','/api/host/listings/:slug',ctx=>({home:saveListing(db,ctx.body,ctx.user,ctx.params.slug)}));
 api('GET','/api/host/calendar',ctx=>hostCalendar(db,ctx.user,ctx.url.searchParams.get('month') || today().slice(0,7),ctx.url.searchParams.get('slug') || undefined));
 api('POST','/api/host/calendar/blocks',ctx=>json(ctx.res,{block:blockDates(db,ctx.user,ctx.body)},201));
 api('DELETE','/api/host/calendar/blocks/:id',ctx=>unblockDates(db,ctx.user,ctx.params.id));
 api('GET','/api/host/reservations',ctx=>({items:reservations(db,ctx.user)}));
 api('POST','/api/host/reservations/:id/respond',ctx=>({booking:respondToReservation(db,ctx.params.id,String(ctx.body.action),ctx.user)}));
 api('GET','/api/host/payouts',ctx=>hostPayouts(db,host(ctx).id));
 api('GET','/api/host/payouts.csv',sendCsv);
 api('GET','/api/support',ctx=>{localOnly(ctx.req);return {items:tickets(db)};});
 api('POST','/api/support',ctx=>json(ctx.res,{ticket:createTicket(db,ctx.body,ctx.user)},201));
 api('GET','/api/feedback',ctx=>{localOnly(ctx.req);return {items:db.prepare('SELECT * FROM feedback ORDER BY created_at DESC,rowid DESC LIMIT 100').all()};});
 api('POST','/api/feedback',ctx=>json(ctx.res,{feedback:createFeedback(db,ctx.body,ctx.user)},201));
 api('GET','/api/flags',ctx=>{localOnly(ctx.req);return {items:flags(db)};});
 api('PATCH','/api/flags/:name',ctx=>{localOnly(ctx.req);const result=setFlag(db,ctx.params.name,ctx.body.enabled);log('flag.updated',result);return result;});
 api('GET','/api/logs',ctx=>{localOnly(ctx.req);return {items:readLogs({slow:ctx.url.searchParams.get('slow')==='1',errors:ctx.url.searchParams.get('errors')==='1',limit:integer(ctx.url.searchParams.get('limit')||100,'Limit',1,1000)})};});
 router.on('GET','/',ctx=>html(ctx.res,homePage(db,ctx.user)));
 router.on('GET','/search',ctx=>{const result=search(db,parseSearch(ctx.url.searchParams));ctx.res.setHeader('Server-Timing',`search;dur=${result.searchMs}`);html(ctx.res,searchPage(db,ctx.url,result,ctx.user));});
 router.on('GET','/homes/:slug',ctx=>html(ctx.res,detailPage(db,ctx.url,home(ctx.params.slug),ctx.user)));
 router.on('GET','/book/:slug',ctx=>html(ctx.res,checkoutPage(db,ctx.url,home(ctx.params.slug),ctx.user)));
 router.on('POST','/book/:slug',ctx=>{requireValue(ctx.body.agree==='1','Please review the house rules and cancellation policy.');const result=createBooking(db,{...ctx.body,slug:ctx.params.slug},ctx.user);redirect(ctx.res,`/bookings/${result.booking.id}`);});
 router.on('GET','/bookings/:id',ctx=>html(ctx.res,confirmationPage(db,guestBooking(db,ctx.params.id,ctx.user),ctx.user)));
 router.on('GET','/trips',ctx=>html(ctx.res,tripsPage(db,guestBookings(db,ctx.user),requireUser(ctx.user,'guest'))));
 router.on('GET','/trips/:id/cancel',ctx=>{const b=guestBooking(db,ctx.params.id,ctx.user);requireValue(['confirmed','pending'].includes(b.status)&&b.from_date>=today(),'This reservation can no longer be cancelled online.');html(ctx.res,cancelPage(db,b,requireUser(ctx.user,'guest')));});
 router.on('POST','/trips/:id/cancel',ctx=>{cancelBooking(db,ctx.params.id,ctx.user);redirect(ctx.res,'/trips?saved=1');});
 router.on('GET','/help',ctx=>html(ctx.res,helpPage(db,ctx.user,ctx.url.searchParams.get('received')||undefined)));
 router.on('POST','/help',ctx=>{const t=createTicket(db,ctx.body,ctx.user);redirect(ctx.res,`/help?received=${t.id}`);});
 router.on('POST','/feedback',ctx=>{const f=createFeedback(db,ctx.body,ctx.user);const next=new URL(safeNext(ctx.body.next || f.page),'http://localhost');next.searchParams.set('feedback','1');redirect(ctx.res,next.pathname+next.search);});
 router.on('GET','/signin',ctx=>html(ctx.res,signInPage(db,safeNext(ctx.url.searchParams.get('next')),ctx.user)));
 router.on('POST','/auth/signin',ctx=>{const u=signIn(db,String(ctx.body.userId),ctx.res);const next=safeNext(ctx.body.next);redirect(ctx.res,next==='/'&&u.role==='host'?'/host':next);});
 router.on('POST','/auth/signout',ctx=>{signOut(ctx.res);redirect(ctx.res,'/');});
 router.on('GET','/host',ctx=>html(ctx.res,hostHomePage(db,dashboard(db,ctx.user),host(ctx))));
 router.on('GET','/host/listings',ctx=>html(ctx.res,hostListingsPage(db,hostListings(db,ctx.user),host(ctx))));
 router.on('GET','/host/listings/new',ctx=>html(ctx.res,listingEditorPage(db,undefined,host(ctx))));
 router.on('POST','/host/listings/new',ctx=>{const h=saveListing(db,ctx.body,ctx.user);redirect(ctx.res,`/host/listings/${h.slug}/edit?saved=1`);});
 router.on('GET','/host/listings/:slug/edit',ctx=>html(ctx.res,listingEditorPage(db,ownedListing(db,ctx.params.slug,ctx.user),host(ctx))));
 router.on('POST','/host/listings/:slug/edit',ctx=>{saveListing(db,ctx.body,ctx.user,ctx.params.slug);redirect(ctx.res,`/host/listings/${ctx.params.slug}/edit?saved=1`);});
 router.on('GET','/host/calendar',ctx=>{const month=ctx.url.searchParams.get('month') || today().slice(0,7),slug=ctx.url.searchParams.get('slug') || undefined;html(ctx.res,hostCalendarPage(db,hostCalendar(db,ctx.user,month,slug),hostListings(db,ctx.user),host(ctx),slug));});
 router.on('POST','/host/calendar/block',ctx=>{const block=blockDates(db,ctx.user,ctx.body);redirect(ctx.res,`/host/calendar?slug=${encodeURIComponent(block.slug)}&month=${block.from.slice(0,7)}&saved=1`);});
 router.on('POST','/host/calendar/unblock/:id',ctx=>{unblockDates(db,ctx.user,ctx.params.id);redirect(ctx.res,'/host/calendar?saved=1');});
 router.on('GET','/host/reservations',ctx=>html(ctx.res,hostReservationsPage(db,reservations(db,ctx.user),host(ctx),ctx.url)));
 router.on('POST','/host/reservations/:id/respond',ctx=>{respondToReservation(db,ctx.params.id,String(ctx.body.action),ctx.user);redirect(ctx.res,'/host/reservations?saved=1');});
 router.on('GET','/host/payouts',ctx=>html(ctx.res,hostPayoutsPage(db,hostPayouts(db,host(ctx).id),host(ctx),ctx.url)));
 router.on('GET','/host/payouts.csv',sendCsv);
 router.on('GET','/admin',ctx=>{localOnly(ctx.req);html(ctx.res,adminPage(db,ctx.user));});
 router.on('POST','/admin/flags/:name',ctx=>{localOnly(ctx.req);const result=setFlag(db,ctx.params.name,ctx.body.enabled==='1');log('flag.updated',result);redirect(ctx.res,'/admin?saved=1');});
 const server=http.createServer(async(req,res)=>{
   const start=performance.now(),requestId=randomUUID(),method=req.method || 'GET';
   const url=new URL(req.url || '/',`http://127.0.0.1:${PORT}`);
   res.setHeader('X-Request-Id',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
   res.setHeader('Cache-Control','no-store');
   res.on('finish',()=>log('http.request',{method,path:url.pathname,status:res.statusCode,ms:Number((performance.now()-start).toFixed(2)),requestId}));
   let user;
   try {
     const hostHeader=req.headers.host || '';
     if(!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader))throw new AppError(403,'HOST_NOT_ALLOWED','Use the local server address.');
     if(['POST','PUT','PATCH','DELETE'].includes(method) && req.headers.origin) {
       let originHost='';try{originHost=new URL(req.headers.origin).host;}catch{}
       if(originHost!==hostHeader)throw new AppError(403,'ORIGIN_NOT_ALLOWED','This request must come from this local site.');
     }
     user=sessionUser(req,db);
     if(method==='HEAD')req.method='GET';
     if(req.method==='GET' && /^\/(css|js|img)\/[a-z0-9.-]+\.(css|js|svg)$/.test(url.pathname)) {
       const path=join(ROOT,'public',url.pathname);
       if(!existsSync(path))throw new AppError(404,'NOT_FOUND','Asset not found.');
       const type=url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'image/svg+xml';
       res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'public, max-age=60'});res.end(readFileSync(path));return;
     }
     await router.dispatch({req,res,db,url,params:{},user,body:await readBody(req),requestId});
   } catch(error) {
     const err=error instanceof AppError?error:new AppError(error instanceof URIError?400:500,error instanceof URIError?'BAD_PATH':'INTERNAL_ERROR',error instanceof URIError?'Invalid URL encoding.':'Something went wrong. Please try again.');
     if(err.status>=500)log('request.failed',{requestId,message:error instanceof Error?error.message:'Unknown error'});
     if(!res.headersSent) {
       if(url.pathname.startsWith('/api/'))json(res,{error:{code:err.code,message:err.message,requestId}},err.status);
       else if(err.status===401 && method==='GET')redirect(res,`/signin?next=${encodeURIComponent(url.pathname+url.search)}`);
       else html(res,errorPage(err.status,err.message,user,url.pathname+url.search),err.status);
     } else res.end();
   }
 });
 return {server,db,router};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const {server,db}=createApp();flushOutbox(db);
 server.listen(PORT,'127.0.0.1',()=>log('server.started',{host:'127.0.0.1',port:PORT,url:`http://127.0.0.1:${PORT}`,today:today()}));
 server.on('error',error=>{log('server.failed',{message:error.message});process.exitCode=1;db.close();});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0);});});
}
