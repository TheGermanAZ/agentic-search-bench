// The SPEC host tool as a stdio MCP server, since CodeMode Unified only bridges tools from MCP servers.
// lookup({id}) waits 200 ms, returns {id, value: id*2} as JSON text, and appends one line per call to
// the file named by argv[2] so the harness can count host-side calls.
import { appendFileSync } from 'node:fs';
const SDK = new URL('../../impls/codemode-unified-bun/repo/node_modules/@modelcontextprotocol/sdk/dist/', import.meta.url).href;
const { Server } = await import(SDK + 'server/index.js');
const { StdioServerTransport } = await import(SDK + 'server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = await import(SDK + 'types.js');

const countFile = process.argv[2];
const server = new Server({ name: 'probe', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'lookup',
      description: 'Look up a value by id. Waits 200 ms and returns { id, value: id * 2 }.',
      inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const id = req.params.arguments?.id;
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 200));
  appendFileSync(countFile, JSON.stringify({ id, started, ended: Date.now() }) + '\n');
  return { content: [{ type: 'text', text: JSON.stringify({ id, value: id * 2 }) }] };
});
await server.connect(new StdioServerTransport());
