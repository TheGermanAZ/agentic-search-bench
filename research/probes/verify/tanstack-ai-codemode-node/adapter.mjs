// tanstack-ai-codemode-node adapter: one createCodeModeTool (node isolate driver) shared by every execution.
import { pathToFileURL, fileURLToPath } from 'node:url';
const NM = fileURLToPath(new URL('../../../impls/tanstack-ai-codemode-node/pkg/node_modules/', import.meta.url));
const load = (p) => import(pathToFileURL(NM + p).href);
const { createCodeModeTool } = await load('@tanstack/ai-code-mode/dist/esm/index.js');
const { toolDefinition } = await load('@tanstack/ai/dist/esm/index.js');
const { z } = await load('zod/index.js');
const { createNodeIsolateDriver } = await load('@tanstack/ai-isolate-node/dist/esm/index.js');
export default async (config, host) => {
  const lookup = toolDefinition({ name: 'lookup', description: 'lookup', inputSchema: z.object({ id: z.number() }) }).server(async ({ id }) => host.lookup(id));
  const failing = toolDefinition({ name: 'failing', description: 'failing', inputSchema: z.object({}) }).server(async () => host.failing());
  const rich = toolDefinition({ name: 'rich', description: 'rich', inputSchema: z.object({}) }).server(async () => host.rich());
  const driver = createNodeIsolateDriver();
  const t = createCodeModeTool({ driver, tools: [lookup, failing, rich], ...(config === 'hardened' ? { timeout: 5000, memoryLimit: 32 } : {}) });
  return {
    name: 'tanstack-ai-codemode-node', T: 'external_lookup', F: 'external_failing', R: 'external_rich', ret: true,
    notes: 'one createCodeModeTool({driver: node}) shared; execute({typescriptCode}) as chat() calls it',
    exec: (typescriptCode) => t.execute({ typescriptCode }),
  };
};
