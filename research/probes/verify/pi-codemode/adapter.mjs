// pi-codemode adapter: one CodemodeSandbox shared by every execution (the P8 harness pattern; see notes).
import { fileURLToPath, pathToFileURL } from 'node:url';
const P = fileURLToPath(new URL('../../../impls/pi-codemode/npm/node_modules/@earendil-works/pi-codemode/dist/index.js', import.meta.url));
const { CodemodeSandbox } = await import(pathToFileURL(P).href);
const CONFIGS = { default: {}, hardened: { timeoutMs: 30_000, memoryLimitBytes: 32 * 1024 * 1024 } };
export default async (config, host) => {
  const obj = { type: 'object', properties: {} };
  const tools = [
    { name: 'lookup', description: 'lookup', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }, execute: async (a) => host.lookup(a.id) },
    { name: 'failing', description: 'failing', inputSchema: obj, execute: async () => host.failing() },
    { name: 'rich', description: 'rich', inputSchema: obj, execute: async () => host.rich() },
  ];
  const sandbox = new CodemodeSandbox({ tools, ...CONFIGS[config] });
  return {
    name: 'pi-codemode', T: 'tools.lookup', F: 'tools.failing', R: 'tools.rich', ret: true,
    notes: `one CodemodeSandbox(${JSON.stringify(CONFIGS[config])}) shared`,
    exec: (code) => sandbox.execute(code),
    close: () => sandbox.close(),
  };
};
