// Extra check: what the MCP server prints to stdout (its JSON-RPC channel) at startup when an MCP
// server in its config has env values. Saves stdout and stderr to out/envlog-stdout.txt / -stderr.txt.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../impls/codemode-unified-bun/repo/', import.meta.url).pathname;
const child = spawn(process.execPath, [REPO + 'dist/mcp-server.js'], {
  env: { PATH: process.env.PATH, HOME: HERE + 'home', MCP_CONFIG_PATH: HERE + 'out/mcp-config-envlog.json', CODEMODE_ENABLE_MCP_INTEGRATION: 'true' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '', err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
setTimeout(() => {
  child.kill();
  writeFileSync(HERE + 'out/envlog-stdout.txt', out);
  writeFileSync(HERE + 'out/envlog-stderr.txt', err);
  console.log(out);
}, 3000);
