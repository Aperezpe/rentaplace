// A guest's own agent reaching the site over MCP: at startup it connects to /mcp with the official SDK client and the
// guest's sign-in cookie, then registers every tool the server lists, schema and all. Nothing about the site is hard-coded.
// Env: MCP_URL, MCP_COOKIE (rap_session=...), MCP_SYSTEM (the whole system prompt).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export default async function (pi: any) {
  const url = process.env.MCP_URL || 'http://127.0.0.1:5180/mcp', cookie = process.env.MCP_COOKIE || '', system = process.env.MCP_SYSTEM || '';
  if (system) pi.on('before_agent_start', () => ({ systemPrompt: system }));
  const client = new Client({ name: 'mcp-visitor', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { cookie } } }));
  pi.on('session_shutdown', () => client.close());
  for (const tool of (await client.listTools()).tools) {
    pi.registerTool({
      name: tool.name, label: tool.name, description: tool.description ?? tool.name, parameters: tool.inputSchema,
      async execute(_id: string, args: Record<string, unknown>) {
        const r: any = await client.callTool({ name: tool.name, arguments: args });
        return { content: r.content, details: {}, isError: !!r.isError };
      },
    });
  }
}
