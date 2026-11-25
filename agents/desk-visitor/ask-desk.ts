// A guest's own agent reaching the site through its guest desk: one tool, ask_desk, which posts a message to /desk
// with the guest's sign-in cookie and returns the desk's JSON answer. Env: DESK_URL, DESK_VISITOR_COOKIE, DESK_VISITOR_SYSTEM.
export default function (pi: any) {
  const url = process.env.DESK_URL || 'http://127.0.0.1:5180/desk', cookie = process.env.DESK_VISITOR_COOKIE || '', system = process.env.DESK_VISITOR_SYSTEM || '';
  if (system) pi.on('before_agent_start', () => ({ systemPrompt: system }));
  pi.registerTool({
    name: 'ask_desk', label: 'Ask desk',
    description: "Send one message to the rental site's guest desk, as the signed-in guest. The desk can look up prices, read a home's rules and place holds. Returns its JSON answer.",
    parameters: { type: 'object', required: ['message'], additionalProperties: false, properties: { message: { type: 'string', description: 'What to ask the desk, in plain words' } } },
    async execute(_id: string, p: { message: string }) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ message: p.message }) });
      const text = await res.text();
      let requestId: string | undefined; try { requestId = JSON.parse(text).requestId ?? JSON.parse(text).error?.requestId; } catch {}
      // requestId lets the comparison find the desk's own receipt (its model's time and cost) for this call.
      return { content: [{ type: 'text', text: `HTTP ${res.status}\n${text}` }], details: { status: res.status, requestId }, isError: !res.ok };
    },
  });
}
