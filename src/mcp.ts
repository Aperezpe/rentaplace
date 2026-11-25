// POST /mcp: the guest desk's three actions as MCP tools, on the official SDK (stateless Streamable HTTP, JSON responses).
// Same sign-in as the site (the rap_session cookie), the same per-visitor rate limit as POST /desk (one shared count),
// and every refusal is a tool error carrying the same code the JSON API uses. No model runs here: the calling agent is the model.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { listingBySlug } from './db.ts';
import { quote } from './domain/bookings.ts';
import { placeHold } from './domain/holds.ts';
import { rulePassage, RULE_TOPICS, RULE_TOPIC_IDS, type RuleTopicId } from './domain/rules.ts';
import { holdKey } from './desk-key.ts';
import { requireUser } from './auth.ts';
import { log } from './log.ts';
import type { DeskGate } from './desk-limits.ts';
import type { Account } from './types.ts';

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (data: Record<string, unknown>): Result => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
/** A refusal as a tool error, shaped like the JSON API's error body so a client reads the same code either way. */
export const toolError = (code: string, message: string): Result => {
  const error = { code, message };
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], structuredContent: { error }, isError: true };
};

const stay = {
  slug: z.string().describe('The home: the last part of its page address, /homes/<slug>'),
  from: z.string().describe('Check-in date, YYYY-MM-DD'),
  to: z.string().describe('Check-out date, YYYY-MM-DD (the day the guest leaves)'),
  guests: z.number().int().min(1).optional().describe('Number of guests, 2 if not given'),
};

/** One MCP server per request (stateless): its tools act as the request's signed-in visitor, or refuse. */
export function mcpServer(db: DatabaseSync, gate: DeskGate, visitor: Account | undefined, requestId: string) {
  const server = new McpServer({ name: 'rentaplace-desk', version: '1.0.0' });
  // Sign-in, then the rate limit, then the action. Any AppError becomes a tool error with its own code.
  const guarded = <A>(tool: string, act: (guest: Account, args: A) => Record<string, unknown>) => async (args: A): Promise<Result> => {
    try {
      const guest = requireUser(visitor, 'guest');
      gate.admitCall(guest.id);
      return ok(act(guest, args));
    } catch (error) {
      const err = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
      if (!(error instanceof AppError)) log('request.failed', { requestId, message: error instanceof Error ? error.message : 'Unknown error' });
      log('mcp.refused', { requestId, tool, code: err.code });
      return toolError(err.code, err.message);
    }
  };
  const home = (slug: string) => { const h = listingBySlug(db, slug); if (!h) throw new AppError(404, 'NOT_FOUND', 'We could not find that home.'); return h; };

  server.registerTool('look_up_price', {
    description: 'The price of a stay at a home: each night, cleaning, service fee, tax and the total in US cents. Refused if the nights are taken.',
    inputSchema: stay,
  }, guarded('look_up_price', (guest, a: { slug: string; from: string; to: string; guests?: number }) => ({ quote: quote(db, a.slug, a.from, a.to, a.guests ?? 2, guest) })));

  server.registerTool('read_home_rules', {
    description: "One passage of a home's published rules on one topic, word for word with its link. NO_PASSAGE when the home publishes nothing on it.",
    inputSchema: { slug: stay.slug, topic: z.enum(RULE_TOPIC_IDS as [RuleTopicId, ...RuleTopicId[]]).describe(RULE_TOPICS.map(t => `${t.id}: ${t.describe}`).join('; ')) },
  }, guarded('read_home_rules', (_guest, a: { slug: string; topic: RuleTopicId }) => {
    const h = home(a.slug), passage = rulePassage(db, h, a.topic);
    if (!passage) throw new AppError(404, 'NO_PASSAGE', `${h.title} publishes no rule on that topic.`);
    return { passage };
  }));

  server.registerTool('place_hold', {
    description: 'Put a stay on hold for the signed-in guest: keeps the nights and the quoted price for 24 hours. No card, no payment. Asking again for the same stay returns the same hold.',
    inputSchema: stay,
  }, guarded('place_hold', (guest, a: { slug: string; from: string; to: string; guests?: number }) => {
    const guests = a.guests ?? 2;
    // The same request key the desk builds in code: same guest, home, dates and guests return the hold already placed.
    const { hold, replayed } = placeHold(db, { slug: a.slug, from: a.from, to: a.to, guests, requestKey: holdKey({ guestId: guest.id, slug: a.slug, from: a.from, to: a.to, guests }) }, guest);
    return { hold, replayed };
  }));
  return server;
}

export async function handleMcp(db: DatabaseSync, gate: DeskGate, req: IncomingMessage, res: ServerResponse, body: unknown, visitor: Account | undefined, requestId: string) {
  const server = mcpServer(db, gate, visitor, requestId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
