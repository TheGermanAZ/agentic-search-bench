// utcp-codemode adapter: one CodeModeUtcpClient shared; callToolChain(code, timeout, memoryLimit).
import { fileURLToPath, pathToFileURL } from 'node:url';
const LIB = fileURLToPath(new URL('../../../impls/utcp-codemode/repo/typescript-library/', import.meta.url));
const { CodeModeUtcpClient } = await import(pathToFileURL(LIB + 'dist/index.js').href);
const { addFunctionToUtcpDirectCall } = await import(pathToFileURL(LIB + 'node_modules/@utcp/direct-call/dist/index.js').href);
export default async (config, host) => {
  addFunctionToUtcpDirectCall('lookup', async (id) => host.lookup(id));
  addFunctionToUtcpDirectCall('failing', async () => host.failing());
  addFunctionToUtcpDirectCall('rich', async () => host.rich());
  const t = (name, props = {}) => ({ name, description: name, inputs: { type: 'object', properties: props }, outputs: { type: 'object' }, tags: [], tool_call_template: { call_template_type: 'direct-call', callable_name: name } });
  addFunctionToUtcpDirectCall('hostManual', async () => ({ utcp_version: '1.0.0', manual_version: '1.0.0', tools: [t('lookup', { id: { type: 'number' } }), t('failing'), t('rich')] }));
  const here = fileURLToPath(new URL('.', import.meta.url));
  const client = await CodeModeUtcpClient.create(here, null);
  const reg = await client.registerManual({ name: 'host', call_template_type: 'direct-call', callable_name: 'hostManual' });
  if (!reg.success) throw new Error('registerManual failed: ' + reg.errors.join('; '));
  const [timeout, mem] = config === 'hardened' ? [10000, 64] : [undefined, undefined];
  return {
    name: 'utcp-codemode', T: 'host.lookup', F: 'host.failing', R: 'host.rich', ret: true,
    notes: `one CodeModeUtcpClient shared; callToolChain(code, ${timeout}, ${mem})`,
    exec: (code) => client.callToolChain(code, timeout, mem),
  };
};
