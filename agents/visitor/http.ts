// The visitor's only tool: one HTTP request to the site, already signed in as the guest. It stands in for a guest's
// own agent, so it says nothing about the site beyond its address: no routes, no API, no RentAPlace terms.
// The runner sets RAP_VISIT_BASE, RAP_VISIT_COOKIE, RAP_VISIT_SYSTEM and RAP_VISIT_DIR.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';

const base = process.env.RAP_VISIT_BASE || 'http://127.0.0.1:5180';
const cookie = process.env.RAP_VISIT_COOKIE || '';
const system = process.env.RAP_VISIT_SYSTEM || '';
const dir = process.env.RAP_VISIT_DIR || '';
// Page text is cut sooner than JSON, which can be large.
const MAX_CHARS = 12000, MAX_JSON_CHARS = 80000;
let seq = 0, savedFirstRequest = false;

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1] ?? '');

/** What a browser shows: the page text, its links and its forms (action, method, fields). */
function pageText(html: string) {
  const links = [...new Set([...html.matchAll(/<a\b[^>]*href="(\/[^"#]*)"/gi)].map(m => decode(m[1])))].slice(0, 80);
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(([, open, inner]) => {
    const fields = [...inner.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].map(([tag]) => {
      const name = attr(tag, 'name'); if (!name) return '';
      const type = attr(tag, 'type'), value = attr(tag, 'value');
      return `${name}${type ? `(${type})` : ''}${value ? `=${value}` : ''}`;
    }).filter(Boolean);
    const buttons = [...inner.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    return `${(attr(`<f ${open}>`, 'method') || 'get').toUpperCase()} ${attr(`<f ${open}>`, 'action') || '(this page)'} fields: ${fields.join(', ') || 'none'}${buttons.length ? ` buttons: ${buttons.join(', ')}` : ''}`;
  });
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return `${text}\n\nLinks: ${links.join(' ')}${forms.length ? `\nForms:\n${forms.join('\n')}` : ''}`;
}

export default function (pi: any) {
  // The run's whole system prompt is the runner's text: no Pi default prompt, no user or project instructions.
  pi.on('before_agent_start', () => (system ? { systemPrompt: system } : undefined));
  // Save the first request the model receives, so a run can be checked for anything the agent was told.
  pi.on('before_provider_request', (event: any) => {
    if (dir && !savedFirstRequest) { savedFirstRequest = true; writeFileSync(join(dir, 'first-request.json'), JSON.stringify(event.payload, null, 2)); }
  });

  pi.registerTool({
    name: 'http',
    label: 'HTTP',
    description: `Send one HTTP request to the website at ${base}, as the signed-in guest. HTML pages come back as their text, links and forms; other responses as they are. Long responses are cut.`,
    parameters: Type.Object({
      method: Type.Union([Type.Literal('GET'), Type.Literal('POST'), Type.Literal('PUT'), Type.Literal('PATCH'), Type.Literal('DELETE')]),
      path: Type.String({ description: 'Path and query on the site, starting with /' }),
      body: Type.Optional(Type.Any({ description: 'Request body: a JSON value, or form fields when form is true' })),
      form: Type.Optional(Type.Boolean({ description: 'Send the body as an HTML form submission instead of JSON' })),
    }),
    async execute(_id: string, params: { method: string; path: string; body?: unknown; form?: boolean }, signal: AbortSignal) {
      const path = String(params.path || '');
      if (!path.startsWith('/') || path.startsWith('//')) return { content: [{ type: 'text', text: 'Refused: path must start with a single /.' }], details: {}, isError: true };
      // The visit stays signed in as its own guest.
      if (/^\/(api\/)?auth\//.test(path)) return { content: [{ type: 'text', text: 'Refused: signing in or out is not part of this visit.' }], details: {}, isError: true };
      const n = ++seq;
      const hasBody = params.body !== undefined && params.method !== 'GET';
      let body: string | undefined, contentType = 'application/json';
      if (hasBody && params.form) {
        const fields = typeof params.body === 'string' ? Object.fromEntries(new URLSearchParams(params.body)) : params.body as Record<string, unknown>;
        body = new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])).toString(); contentType = 'application/x-www-form-urlencoded';
      } else if (hasBody) {
        // Models often pass the body as a JSON string; send that as is instead of encoding it twice.
        body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
      }
      const res = await fetch(base + path, {
        method: params.method, redirect: 'manual', signal, body,
        headers: { cookie, accept: 'text/html, application/json', ...(hasBody ? { 'content-type': contentType } : {}) },
      });
      const requestId = res.headers.get('x-request-id');
      if (dir) appendFileSync(join(dir, 'trace.jsonl'), JSON.stringify({ seq: n, method: params.method, path, requestId, status: res.status }) + '\n');
      const type = res.headers.get('content-type') || '';
      let text = await res.text();
      if (type.includes('text/html')) text = pageText(text);
      const max = type.includes('json') ? MAX_JSON_CHARS : MAX_CHARS;
      if (text.length > max) text = text.slice(0, max) + `\n[cut: ${text.length - max} more characters]`;
      const location = res.headers.get('location');
      return { content: [{ type: 'text', text: `HTTP ${res.status}${location ? ` -> ${location}` : ''}\n${text}` }], details: { status: res.status } };
    },
  });
}
