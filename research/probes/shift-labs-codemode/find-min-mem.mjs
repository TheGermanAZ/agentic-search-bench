// Finds the smallest memoryLimitBytes (MB steps) at which `return 1+1` runs. Writes out/hardened-min-memory.txt.
import { writeFileSync } from "node:fs";
import { Codemode } from "../../impls/shift-labs-codemode/core/dist/index.js";
const rows = [];
for (const mb of [8, 10, 12, 14, 16, 20, 24, 32]) {
  const cm = Codemode.create({ plugins: [], memoryLimitBytes: mb * 1048576, maxRunsPerWorker: 1 });
  const oks = [];
  for (let i = 0; i < 3; i++) { const r = await cm.execute("return 1+1"); oks.push(r.result === 2 ? "ok" : r.error); }
  cm.dispose();
  rows.push({ mb, runs: oks });
}
writeFileSync(new URL("./out/hardened-min-memory.txt", import.meta.url), JSON.stringify(rows, null, 2) + "\n");
console.log(JSON.stringify(rows));
