// Small allocations to see whether voidmcp's --memory limit is enforced (stays well under 1 GB).
import { McpProc } from "./mcp-client.mjs";
import { writeFileSync } from "node:fs";
const STATE = new URL("./state/", import.meta.url).pathname;
const extra = process.argv.slice(2);
const p = new McpProc(new URL("../../impls/voidmcp/bin/voidmcp", import.meta.url).pathname, ["serve", "--stdio", "--db", STATE + "voidmcp.db", "--watch-interval", "0", ...extra], { env: { ...process.env, HOME: STATE } });
await p.init();
const out = { flags: extra, runs: [] };
for (const code of [
  'const s = "x".repeat(20e6); return s.length',
  'const a = []; for (let i = 0; i < 40; i++) a.push("x".repeat(1e6)); return a.length',
  'const a = []; for (let i = 0; i < 200; i++) a.push("x".repeat(1e6)); return a.length',
  'const a = []; for (let i = 0; i < 200; i++) a.push(new Array(1e5).fill(i)); return a.length',
]) {
  const r = await p.call("execute_code", { code }, 60000);
  out.runs.push({ code, ms: Math.round(r.ms), resp: JSON.stringify(r.resp).slice(0, 400) });
}
writeFileSync(new URL("./out/" + (extra.length ? "hardened-" : "") + "P7-small-allocs.txt", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
p.kill(); process.exit(0);
