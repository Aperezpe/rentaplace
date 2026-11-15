import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, input } from './helpers.ts';
import { createApp } from '../src/server.ts';
// Day 4: the log keeps the question (path and query) so an error can be replayed, and never the body.
const logText=()=>readFileSync(join(process.env.RAP_LOG_DIR!,'app.log'),'utf8');
async function withApp(run:(base:string)=>Promise<void>) {
 const {db}=fixture();const {server}=createApp(db);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 try{await run(`http://127.0.0.1:${port}`);}finally{await new Promise(r=>server.close(r));db.close();}
}
test('the request log line carries the query string',async()=>{
 await withApp(async base=>{
  const query='?slug=lakeside-a-frame&from=2026-11-16&to=2026-11-19&guests=2';
  const r=await fetch(base+'/api/quote'+query);assert.equal(r.status,200);
  const id=r.headers.get('x-request-id');await new Promise(r=>setTimeout(r,30));
  const line=logText().trim().split('\n').map(l=>JSON.parse(l)).find(l=>l.requestId===id&&l.event==='http.request');
  assert.equal(line.path,'/api/quote');assert.equal(line.query,query);
 });
});
test('a booking\'s card number and sign-in body never reach the log',async()=>{
 await withApp(async base=>{
  const sign=await fetch(base+'/api/auth/signin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:'guest-1'})});
  assert.equal(sign.status,200);const cookie=sign.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const marker='UNIQUE-NOTE-7731';
  const book=await fetch(base+'/api/bookings',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({...input,idempotencyKey:'log-query-test-0001',note:marker})});
  assert.ok([200,201].includes(book.status),`booking answered ${book.status}`);
  await new Promise(r=>setTimeout(r,30));const text=logText();
  assert.ok(text.includes('"path":"/api/bookings"'),'the booking request was logged');
  for(const secret of ['4242','mira@example.test',marker,'guest-1','cardNumber'])assert.ok(!text.includes(secret),`log must not contain ${secret}`);
 });
});
