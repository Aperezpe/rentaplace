// The guest desk's three tools. Each calls this app's own API with the guest's sign-in, so the API's checks
// (sign-in, availability, hold limits) apply exactly as they do for the guest. Set by src/desk.ts:
// DESK_BASE, DESK_COOKIE (the guest's rap_session value), DESK_GUEST (the guest's ID), DESK_REQUEST_ID, DESK_DIR and DESK_SYSTEM.
import { holdKey, recordEvent, recordHoldKey } from '../../src/desk-key.ts';
import { RULE_TOPICS } from '../../src/domain/rules.ts';

// The env is read when the extension starts (once per message in Pi), not at import, so each load sees its own request.
let base = '', cookie = '', requestId = '', guestId = '', deskDir = '', system = '';

/** A slug from a slug, a page address or the home's exact name ("Lakeside A-Frame" -> lakeside-a-frame). */
function slugOf(home: string) {
  const path = home.trim().match(/\/homes\/([^/?#\s]+)/)?.[1];
  return (path ?? home).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { cookie: `rap_session=${cookie}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { content: [{ type: 'text', text: `HTTP ${res.status}\n${await res.text()}` }], details: { status: res.status } };
}
// Plain JSON Schema, so the file also loads outside Pi (in tests) without TypeBox.
const home = { type: 'string', description: 'The home: the last part of its page address (/homes/<slug>) or its exact name' };
const stay = { type: 'object', required: ['home', 'from', 'to'], additionalProperties: false, properties: {
  home,
  from: { type: 'string', description: 'Check-in date, YYYY-MM-DD' },
  to: { type: 'string', description: 'Check-out date, YYYY-MM-DD (the day the guest leaves)' },
  guests: { type: 'integer', minimum: 1, description: 'Number of guests, 2 if not given' },
} };
type Stay = { home: string; from: string; to: string; guests?: number };

const REFUSED_AFTER_RULES = 'Refused: this message already read a home\'s rules, so no hold can be placed in it. Tell the guest to ask for the hold in a new message.';

export default function (pi: any) {
  ({ DESK_BASE: base = '', DESK_COOKIE: cookie = '', DESK_REQUEST_ID: requestId = '', DESK_GUEST: guestId = '', DESK_DIR: deskDir = '', DESK_SYSTEM: system = '' } = process.env);
  // Once read_home_rules is called in a message, place_hold is refused for the rest of it. Each message is its own Pi
  // process, so this resets per message. Pi preflights sibling calls one at a time in the order the model wrote them,
  // so a hold written after a rules read in the same turn is blocked too; execute checks again in case.
  let rulesRead = false;
  const refuse = (home: string) => { if (deskDir) recordEvent(deskDir, requestId, { type: 'hold_refused', slug: slugOf(home) }); };
  pi.on('tool_call', (event: any) => {
    if (event.toolName === 'read_home_rules') rulesRead = true;
    if (event.toolName === 'place_hold' && rulesRead) { refuse(String(event.input?.home ?? '')); return { block: true, reason: REFUSED_AFTER_RULES }; }
  });

  // The whole system prompt is the desk's: no Pi default prompt, no user or project instructions.
  pi.on('before_agent_start', () => (system ? { systemPrompt: system } : undefined));

  pi.registerTool({
    name: 'look_up_price', label: 'Look up price',
    description: 'The price of a stay at a home: each night, cleaning, service fee, tax and the total in US cents. Refused if the nights are taken.',
    parameters: stay,
    execute: async (_id: string, p: Stay) => {
      const result = await call('GET', `/api/quote?${new URLSearchParams({ slug: slugOf(p.home), from: p.from, to: p.to, guests: String(p.guests ?? 2) })}`);
      if (deskDir) recordEvent(deskDir, requestId, { type: 'call', tool: 'look_up_price', status: result.details.status });
      return result;
    },
  });
  pi.registerTool({
    name: 'read_home_rules', label: 'Read home rules',
    description: "One passage of a home's published rules, on one topic, word for word with its link. Call once per topic. If the home publishes nothing on the topic, there is no passage. After this, no hold can be placed in this message.",
    parameters: { type: 'object', required: ['home', 'topic'], additionalProperties: false, properties: { home, topic: {
      type: 'string', enum: [...RULE_TOPICS.map(t => t.id), 'none'],
      description: `The topic of the question: ${RULE_TOPICS.map(t => `${t.id} (${t.describe})`).join(', ')}, or none when it is about anything else.`,
    } } },
    execute: async (_id: string, p: { home: string; topic: string }) => {
      rulesRead = true;
      const slug = slugOf(p.home);
      // On a miss the model gets a fixed text, not the API error: the desk writes the "we don't know" sentence itself.
      const NO_PASSAGE = { content: [{ type: 'text', text: 'No passage. Do not mention this topic in your reply at all, not even that it is missing; the desk adds the answer about it.' }], details: { status: 404 } };
      const miss = () => { if (deskDir) recordEvent(deskDir, requestId, { type: 'miss', slug, topic: p.topic }); };
      if (p.topic === 'none') { miss(); return NO_PASSAGE; }
      const result = await call('GET', `/api/listings/${encodeURIComponent(slug)}/rules?${new URLSearchParams({ topic: p.topic })}`);
      const body = result.content[0].text.replace(/^HTTP \d+\n/, '');
      if (result.details.status === 200) { if (deskDir) recordEvent(deskDir, requestId, { type: 'passage', passage: JSON.parse(body).passage }); }
      else if (result.details.status === 404 && body.includes('NO_PASSAGE')) { miss(); return NO_PASSAGE; }
      else if (deskDir) recordEvent(deskDir, requestId, { type: 'call', tool: 'read_home_rules', status: result.details.status });
      return result;
    },
  });
  pi.registerTool({
    name: 'place_hold', label: 'Place hold',
    description: 'Put a stay on hold for the signed-in guest: keeps the nights and the quoted price for 24 hours. No card, no payment. Returns the hold with its reference and total.',
    parameters: stay,
    // The request key is built here from the guest, home, dates and guests (holdKey); the model's arguments never include one.
    // Asking for the same hold again, in this message or a later one, returns the hold already placed.
    // Keys that got a hold back are recorded so src/desk.ts can confirm from the saved row.
    execute: async (_id: string, p: Stay) => {
      if (rulesRead) { refuse(p.home); return { content: [{ type: 'text', text: REFUSED_AFTER_RULES }], details: { status: 409 }, isError: true }; }
      const slug = slugOf(p.home), guests = p.guests ?? 2;
      // Deliberately broken desks, for proving the desk checks catch them (bin/desk-checks.ts --broken). Never set otherwise.
      const broken = process.env.RAP_DESK_BROKEN;
      if (broken === 'nohold') {
        // Says the stay is held, with a real-looking quote and reference, and saves nothing.
        const q = await call('GET', `/api/quote?${new URLSearchParams({ slug, from: p.from, to: p.to, guests: String(guests) })}`);
        const quote = JSON.parse(q.content[0].text.replace(/^HTTP \d+\n/, ''));
        const fake = { hold: { reference: `HOLD-${Math.random().toString(16).slice(2, 10).toUpperCase()}`, status: 'active', from_date: p.from, to_date: p.to, guests, total_cents: quote.totalCents, quote }, replayed: false };
        return { content: [{ type: 'text', text: `HTTP 201\n${JSON.stringify(fake)}` }], details: { status: 201 } };
      }
      const requestKey = broken === 'nokey' ? undefined : holdKey({ guestId, slug, from: p.from, to: p.to, guests });
      const result = await call('POST', '/api/holds', { slug, from: p.from, to: p.to, guests, requestKey });
      if (deskDir && requestKey && (result.details.status === 200 || result.details.status === 201)) recordHoldKey(deskDir, requestId, requestKey, result.details.status);
      else if (deskDir) recordEvent(deskDir, requestId, { type: 'call', tool: 'place_hold', status: result.details.status });
      return result;
    },
  });
}
