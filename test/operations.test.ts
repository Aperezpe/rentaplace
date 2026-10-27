import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,guest } from './helpers.ts';
import { createTicket,tickets } from '../src/domain/support.ts';
import { createFeedback } from '../src/domain/feedback.ts';
import { setFlag,enabled } from '../src/flags.ts';
import { openDatabase } from '../src/db.ts';
import { seedDatabase } from '../data/seed.ts';
import { openapi } from '../src/openapi.ts';
import { createApp } from '../src/server.ts';
import { createHash } from 'node:crypto';
test('support saves the supplied message without a category or owner',()=>{
 const {db}=fixture();const t=createTicket(db,{subject:'Help with arrival',message:'Where can I find check-in details?'},guest);assert.equal(t.category,'uncategorized');assert.equal(t.ownerId,null);assert.equal(tickets(db).length,1);assert.throws(()=>createTicket(db,{name:'Mira',email:'bad',subject:'Help',message:'Hello'}));db.close();
});
test('feedback includes the local page, rating, text and application time',()=>{
 const {db}=fixture();const f=createFeedback(db,{page:'/homes/lakeside-a-frame',rating:'needs-work',text:'The dates could be clearer.'},guest);assert.equal(f.page,'/homes/lakeside-a-frame');assert.equal(f.createdAt.slice(0,10),'2026-11-09');assert.throws(()=>createFeedback(db,{page:'https://example.test',text:'Hello'},guest));db.close();
});
test('feature flags control support and feedback and validate values',()=>{
 const {db}=fixture();setFlag(db,'support_form',false);assert.equal(enabled(db,'support_form'),false);assert.throws(()=>createTicket(db,{subject:'Hi',message:'Help'},guest),{status:503});setFlag(db,'guest_feedback',false);assert.throws(()=>createFeedback(db,{page:'/',text:'Hi'},guest),{status:503});assert.throws(()=>setFlag(db,'unknown',true),{status:404});assert.throws(()=>setFlag(db,'map_panel','false'));db.close();
});
test('seed rows are deterministic, with stable anchors and expected catalog sizes',()=>{
 const a=openDatabase(':memory:'),b=openDatabase(':memory:');seedDatabase(a);seedDatabase(b);
 const tables=['users','listings','bookings','reviews','payouts','support_tickets','regions','flags'];
 const digest=(db:any)=>createHash('sha256').update(JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).digest('hex');assert.equal(digest(a),digest(b));
 assert.equal((a.prepare('SELECT COUNT(*) n FROM listings').get() as any).n,700);assert.equal((a.prepare('SELECT COUNT(*) n FROM bookings').get() as any).n,10002);assert.equal((a.prepare('SELECT nightly_cents FROM listings WHERE slug=?').get('lakeside-a-frame') as any).nightly_cents,11000);a.close();b.close();
});
test('all JSON routes have a matching OpenAPI method and path',()=>{
 const {db}=fixture();const {server,router}=createApp(db);
 const paths=Object.keys(openapi.paths),routes=router.routes.filter(r=>r.pattern.source.startsWith('^\\/api\\/'));
 for(const path of paths)for(const method of Object.keys((openapi.paths as any)[path]))assert.ok(router.routes.some(r=>r.method===method.toUpperCase()&&r.pattern.test(path.replace(/\{[^}]+\}/g,'sample'))),`${method} ${path} is implemented`);
 for(const route of routes)assert.ok(paths.some(path=>route.pattern.test(path.replace(/\{[^}]+\}/g,'sample'))&&Object.keys((openapi.paths as any)[path]).includes(route.method.toLowerCase())),`Document ${route.method} ${route.pattern}`);
 server.close();db.close();
});
