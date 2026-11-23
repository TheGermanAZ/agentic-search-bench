// vercel-ai-sdk-codemode adapter: one experimental_createCodeModeTool instance shared by every execution.
import { pathToFileURL, fileURLToPath } from 'node:url';
const NM = fileURLToPath(new URL('../../../impls/vercel-ai-sdk-codemode/pkg/node_modules/', import.meta.url));
const { experimental_createCodeModeTool } = await import(pathToFileURL(NM + '@ai-sdk/code-mode/dist/index.js').href);
const { tool, jsonSchema } = await import(pathToFileURL(NM + 'ai/dist/index.js').href);
const MiB = 1024 * 1024;
const HARDENED_POLICY = { timeoutMs: 15_000, cpuTimeoutMs: 5_000, memoryLimitBytes: 32 * MiB, maxStackSizeBytes: MiB, maxSourceBytes: 128 * 1024, maxResultBytes: 512 * 1024, maxConsoleOutputBytes: 32 * 1024, maxToolInputBytes: 256 * 1024, maxToolOutputBytes: MiB, maxBridgeRequests: 100, maxInFlightBridgeRequests: 8 };
export default async (config, host) => {
  const obj = jsonSchema({ type: 'object', properties: {}, additionalProperties: true });
  const tools = {
    lookup: tool({ description: 'lookup', inputSchema: jsonSchema({ type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }), execute: async ({ id }) => host.lookup(id) }),
    failing: tool({ description: 'failing', inputSchema: obj, execute: async () => host.failing() }),
    rich: tool({ description: 'rich', inputSchema: obj, execute: async () => host.rich() }),
  };
  const cm = experimental_createCodeModeTool(tools, config === 'hardened' ? { executionPolicy: HARDENED_POLICY } : {});
  let n = 0;
  return {
    name: 'vercel-ai-sdk-codemode', T: 'tools.lookup', F: 'tools.failing', R: 'tools.rich', ret: true,
    notes: 'one experimental_createCodeModeTool shared; execute({js}) as generateText calls it',
    exec: (js) => cm.execute({ js }, { toolCallId: `r-${++n}`, messages: [] }),
  };
};
