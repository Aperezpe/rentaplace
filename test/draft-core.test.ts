import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customerFacing, facts, amountsIn, checkDraft, dollars } from '../drafts/core.mjs';
import { fixture } from './helpers.ts';
import { quote } from '../src/domain/bookings.ts';
const stay={slug:'lakeside-a-frame',from:'2026-11-16',to:'2026-11-19',guests:2};
test('the writer is handed only the customer-facing notes, without their engineering sources',()=>{
 const notes=customerFacing(readFileSync(new URL('../agents/booking/memories.md',import.meta.url),'utf8'));
 assert.ok(notes.length>=3);const all=notes.join('\n');
 assert.ok(all.includes('The first price a guest sees is the price they pay'));
 for(const internal of ['idempotency','transaction','host\'s share','assertAvailable','commit ','tracker card','GLOSSARY'])assert.ok(!all.includes(internal),`must not include ${internal}`);
});
test('a real quote becomes dollar facts and a list of looked-up amounts',()=>{
 const {db}=fixture();const q=quote(db,stay.slug,stay.from,stay.to,stay.guests);db.close();
 const f=facts(stay,{ok:true,quote:q});
 assert.ok(f.lines.some(l=>l===`- total: ${dollars(q.totalCents)}`));assert.ok(f.allowedCents.includes(q.totalCents));assert.ok(f.allowedCents.includes(11000));
});
test('a failed lookup is said as UNKNOWN and allows no amount at all',()=>{
 const f=facts(stay,{ok:false,reason:'HTTP 503'});
 assert.ok(f.lines.some(l=>l.includes('price: UNKNOWN')));assert.deepEqual(f.allowedCents,[]);assert.ok(!f.lines.join('\n').includes('$'));
});
test('amounts are found however they are written',()=>{
 assert.deepEqual(amountsIn('Total $468.00, or $1,234.50; about 420 dollars; USD 390. Three nights.').map(a=>a.cents),[46800,123450,42000,39000]);
 assert.deepEqual(amountsIn('3 nights for 2 guests on Nov 16').length,0);
});
test('the number check passes looked-up amounts and rejects a planted wrong one',()=>{
 const allowed=[46800,11000,6000];
 assert.equal(checkDraft('Your stay comes to $468.00 ($110 a night plus $60.00 cleaning).',allowed).ok,true);
 const bad=checkDraft('Your stay comes to $486.00.',allowed);assert.equal(bad.ok,false);assert.equal(bad.notLookedUp[0].cents,48600);
 assert.equal(checkDraft('It should be around $400.',[]).ok,false);
 assert.equal(checkDraft('We could not check the price right now.',[]).ok,true);
});
