#!/usr/bin/env node
// Watch RentAPlace's own log and wake the hunter for each failed request. Nobody types anything.
// It saves how far it has read (HUNT_STATE) only after the host has answered, so a restart carries on from there.
// A kill between sending and saving means the event is sent again; the host runs each event ID once.
// env: HUNT_LOG (app.log), HUNT_STATE (json file), HUNT_HOST (http://127.0.0.1:port), HUNT_TOKEN
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readNew, START } from './watch-core.mjs';
const { HUNT_LOG: logFile, HUNT_STATE: stateFile, HUNT_HOST: host, HUNT_TOKEN: token } = process.env;
if (!logFile || !stateFile || !host || !token) { console.error('need HUNT_LOG, HUNT_STATE, HUNT_HOST, HUNT_TOKEN'); process.exit(2); }
let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : START;
const save = (next) => { writeFileSync(stateFile + '.tmp', JSON.stringify(next)); renameSync(stateFile + '.tmp', stateFile); state = next; };
const say = (row) => console.log(JSON.stringify(row));
async function tick() {
  if (!existsSync(logFile)) return;
  const size = statSync(logFile).size;
  if (size <= state.offset) return;
  const bytes = Buffer.alloc(size - state.offset);
  const fd = openSync(logFile, 'r');
  try { readSync(fd, bytes, 0, bytes.length, state.offset); } finally { closeSync(fd); }
  const { events, next } = readNew(state, bytes);
  for (const event of events) {
    const res = await fetch(host + '/wake', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(event) });
    const answer = await res.json().catch(() => ({}));
    say({ sent: event.id, http: res.status, status: answer.status ?? 'accepted' });
    if (res.status !== 202 && res.status !== 200) return; // not accepted: keep the old position and try again
    if (process.env.WATCH_DIE_AFTER_SEND) process.exit(9); // test only: die after sending, before saving
  }
  if (next.offset !== state.offset) save(next);
}
say({ watching: logFile, from: state.offset });
for (;;) { try { await tick(); } catch (error) { say({ error: String(error) }); } await new Promise((r) => setTimeout(r, 150)); }
