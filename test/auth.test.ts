import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, verifySession, requireUser, safeNext } from '../src/auth.ts';
import { guest, host } from './helpers.ts';
test('signed sessions verify and tampered payloads do not',()=>{
 const signed=makeSession(guest.id);assert.equal(verifySession(signed),guest.id);
 const parts=signed.split('.');parts[0]=Buffer.from(JSON.stringify({id:'host-1',expiry:9999999999999})).toString('base64url');assert.equal(verifySession(parts.join('.')),undefined);
 assert.equal(verifySession(signed+'x'),undefined);assert.equal(verifySession('bad'),undefined);
});
test('guest and host capabilities require the right account role',()=>{
 assert.throws(()=>requireUser(undefined),/sign-in/);assert.throws(()=>requireUser(guest,'host'),/host/);assert.throws(()=>requireUser(host,'guest'),/guest/);assert.equal(requireUser(guest,'guest'),guest);
});
test('sign-in return destinations stay within the site',()=>{
 assert.equal(safeNext('/trips?view=next'),'/trips?view=next');for(const path of ['https://example.test','//example.test','/\\example.test','/\nheader'])assert.equal(safeNext(path),'/');
});
