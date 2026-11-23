// Runs the SPEC P7 loop (for-range form) on one MCP session and, 300 ms later, P1 on a second session.
// Shows whether another session still works while one script allocates. Usage: node lib/concurrent.mjs <out-file>
import { writeFileSync } from "node:fs";
import { connect, rss } from "../config.mjs";
const [outFile] = process.argv.slice(2);
const a = await connect(), b = await connect();
let peak = 0; const s = setInterval(async () => { peak = Math.max(peak, await rss().catch(() => 0)); }, 100);
const t0 = performance.now(); const at = () => Math.round(performance.now() - t0);
const p7 = a.client.callTool({ name: "execute_tool_script", arguments: { script: `a = []\nfor i in range(1000000000000):\n    a.append("x" * 1000000)` } }, undefined, { timeout: 125000 })
  .then((r) => ({ doneAtMs: at(), isError: r.isError, text: r.content?.[0]?.text }), (e) => ({ doneAtMs: at(), error: String(e) }));
await new Promise((r) => setTimeout(r, 300));
const p1 = b.client.callTool({ name: "execute_tool_script", arguments: { script: `r = probe_lookup(id=21)\nreturn r["text"]` } }, undefined, { timeout: 125000 })
  .then((r) => ({ startedAtMs: 300, doneAtMs: at(), isError: r.isError, text: r.content?.[0]?.text }), (e) => ({ doneAtMs: at(), error: String(e) }));
const res = { p7: await p7, concurrentP1: await p1 };
clearInterval(s); res.peakRssMB = Math.max(peak, await rss().catch(() => 0));
const after = await b.client.callTool({ name: "execute_tool_script", arguments: { script: "return 1 + 1" } }).then((r) => r.content?.[0]?.text, (e) => String(e));
res.laterExecution = after;
writeFileSync(outFile, JSON.stringify(res, null, 2) + "\n"); console.log(JSON.stringify(res));
await a.client.close(); await b.client.close(); process.exit(0);
