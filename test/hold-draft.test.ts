import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/bootstrap.ts';
import { placeHold } from '../src/domain/holds.ts';
// @ts-ignore plain module
import { holdRefIn, lookUpHold, holdFacts, checkHoldDraft, untilText, timesIn } from '../drafts/hold.mjs';

const CLOCK='2026-11-09T12:00:00.000Z';
function held() {
  const dir=mkdtempSync(join(tmpdir(),'hold-draft-')),file=join(dir,'app.db');
  const db=bootstrap(file);
  const guest:any=db.prepare("SELECT * FROM users WHERE id='guest-1'").get();
  const {hold}=placeHold(db,{slug:'lakeside-a-frame',from:'2026-11-16',to:'2026-11-19',guests:2},guest,CLOCK);
  db.close();
  return {file,hold};
}
test('the hold reference is read only when exactly one is written',()=>{
  assert.equal(holdRefIn('My hold hold-1a2b3c4d, until when?'),'HOLD-1A2B3C4D');
  assert.equal(holdRefIn('HOLD-1A2B3C4D or HOLD-99999999?'),null);
  assert.equal(holdRefIn('I placed a hold yesterday'),null);
});
test('an active hold: until when and at what price come from the hold row',()=>{
  const {file,hold}=held();
  const l=lookUpHold(file,hold.reference,'2026-11-09T18:00:00.000Z');
  assert.equal(l.ok,true);assert.equal(l.hold!.status,'active');assert.equal(l.hold!.totalCents,46800);
  const f=holdFacts(hold.reference,l);
  assert.equal(f.until,'10 November 2026, 12:00 UTC');
  assert.ok(f.lines.some((x:string)=>x.includes('held total: $468.00')));
  assert.equal(checkHoldDraft('Your stay is held until 10 November 2026, 12:00 UTC at $468.00.',f).ok,true);
  // Planted: a wrong amount, a wrong time, and a length of time nobody looked up are each rejected.
  assert.equal(checkHoldDraft('Held until 10 November 2026, 12:00 UTC at $486.00.',f).ok,false);
  assert.deepEqual(checkHoldDraft('Held until 3 pm tomorrow at $468.00.',f).timesNotLookedUp,['3 pm']);
  assert.deepEqual(checkHoldDraft('Your hold lasts 48 hours, total $468.00.',f).timesNotLookedUp,['48 hours']);
});
test('the same hold after its 24 hours: it keeps nothing, and no amount is allowed',()=>{
  const {file,hold}=held();
  const l=lookUpHold(file,hold.reference,'2026-11-10T12:00:00.000Z');
  assert.equal(l.hold!.status,'expired');
  const f=holdFacts(hold.reference,l);
  assert.deepEqual(f.allowedCents,[]);
  assert.ok(f.lines.join('\n').includes('ran out on 10 November 2026, 12:00 UTC'));
  assert.equal(checkHoldDraft('It is still held at $468.00.',f).ok,false);
});
test('a failed hold lookup is said as UNKNOWN, never dropped',()=>{
  const {file}=held();
  for(const l of [lookUpHold(file,'HOLD-00000000',CLOCK),lookUpHold('/nonexistent/app.db','HOLD-00000000',CLOCK)]) {
    assert.equal(l.ok,false);
    const f=holdFacts('HOLD-00000000',l);
    assert.ok(f.lines.some((x:string)=>x.includes('UNKNOWN')));assert.deepEqual(f.allowedCents,[]);
    assert.equal(checkHoldDraft('Holds last 24 hours, and yours is $468.00.',f).ok,false);
  }
});
test('times and lengths of time written in a draft',()=>{
  assert.deepEqual(timesIn('until 12:00 UTC, or noon, for 24 hours'),['12:00','noon','24 hours']);
  assert.equal(untilText('2026-11-10T12:00:00.000Z'),'10 November 2026, 12:00 UTC');
});
