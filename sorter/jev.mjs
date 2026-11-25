// Jev for the trial. The questions and decide rule live in src/jev.ts, shared with the live sorter.
// Run alone for one test call: node sorter/jev.mjs
export { JEV, USD_PER_INPUT_TOKEN, MONEY_P, SURE_P, SURE_OWNER, QUESTIONS, decide, callJev, parseJev } from '../src/jev.ts';
import { callJev, parseJev } from '../src/jev.ts';

if (import.meta.url === `file://${process.argv[1]}`) {
  const ticket = { subject: 'Seeing double', message: 'My card statement shows the same weekend at Pine Hollow twice. I only booked it once.' };
  const r = await callJev(ticket);
  console.log(JSON.stringify({ ...r, parsed: r.ok ? parseJev(r.raw) : null }, null, 2));
}
