import test from 'node:test';
import assert from 'node:assert/strict';
import { readNew, START } from '../hunter/watch-core.mjs';
const fail=(id:string)=>JSON.stringify({event:'request.failed',requestId:id,message:'x'})+'\n';
const req=(id:string,status=500)=>JSON.stringify({event:'http.request',method:'GET',path:'/api/quote',query:'?a=1',status,requestId:id})+'\n';
test('a failure and its request line become one wake event, and the position moves past both',()=>{
 const text=fail('a')+req('a');const {events,next}=readNew(START,Buffer.from(text));
 assert.equal(events.length,1);assert.equal(events[0].id,'a');assert.equal(events[0].lines.length,2);assert.equal(next.offset,Buffer.byteLength(text));assert.deepEqual(next.pending,{});
});
test('reading again from the saved position sends nothing twice',()=>{
 const text=fail('a')+req('a');const first=readNew(START,Buffer.from(text));
 const more=req('b',200);const second=readNew(first.next,Buffer.from(more));
 assert.equal(second.events.length,0);assert.equal(second.next.offset,Buffer.byteLength(text+more));
});
test('a half-written last line is left for the next read',()=>{
 const whole=fail('a'),half=req('a').slice(0,20);const one=readNew(START,Buffer.from(whole+half));
 assert.equal(one.events.length,0);assert.equal(one.next.offset,Buffer.byteLength(whole));assert.ok(one.next.pending.a);
 const two=readNew(one.next,Buffer.from(req('a')));assert.equal(two.events.length,1);
});
test('a failure waits for its request line across reads, with other requests in between',()=>{
 const one=readNew(START,Buffer.from(fail('a')+req('z',200)+fail('b')));assert.equal(one.events.length,0);
 const two=readNew(one.next,Buffer.from(req('b')+req('a')));assert.deepEqual(two.events.map((e:{id:string})=>e.id),['b','a']);
});
test('ordinary requests and broken lines wake nothing',()=>{
 const {events}=readNew(START,Buffer.from(req('a',200)+'not json\n'+req('b',404)));assert.equal(events.length,0);
});
