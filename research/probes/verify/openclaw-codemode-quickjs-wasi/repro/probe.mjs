// SPEC/RUBRIC probes for OpenClaw Code Mode, driven through the model-facing `exec` control tool.
// Usage: ENGINE=node|quickjs [HARDENED=1] OUT=<dir> node probe.mjs P1 P2 ...
// The `exec` tool comes from createCodeModeTools() and the hidden catalog from applyCodeModeCatalog(),
// the two calls the embedded agent runtime makes when Code Mode is active (src/agents/code-mode.ts:220, :313).
// They are not part of the package's public `exports`, so they are imported from the published dist chunks.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "../../../../impls/openclaw-codemode-node-vm/npm/node_modules/openclaw/dist");
const ENGINE = process.env.ENGINE ?? "node";
const HARDENED = process.env.HARDENED === "1";
const OUT = resolve(process.env.OUT ?? `${here}/out`);
// WARM_HOST=1 runs every cell inside a bound LegacyPluginSdkResourceHost + GatewayScheduler, as the
// Gateway does, so Node workers are reused (scripts/perf/code-mode-engine-measure.ts does the same).
const WARM = process.env.WARM_HOST === "1";
const PREFIX = (HARDENED ? "hardened-" : "") + (WARM ? "warm-" : "");
mkdirSync(OUT, { recursive: true });

const { i: createCodeModeTools, n: applyCodeModeCatalog } = await import(`${DIST}/prompt-tool-policy-XiWNJtPU.mjs`);
const { g: createToolSearchCatalogRef } = await import(`${DIST}/tool-search-tPlKa2sf.mjs`);
const { o: setPluginToolMeta } = await import(`${DIST}/tool-metadata-rqUpUHlb.mjs`);

// Hardened: tightest documented clamps that still let P9 run (docs/tools/code-mode/configuration.md table).
const codeMode = HARDENED
  ? { enabled: true, executor: ENGINE, timeoutMs: 5000, memoryLimitBytes: 16 * 1024 * 1024, maxOutputBytes: 8192, maxSnapshotBytes: 1024 * 1024, maxPendingToolCalls: 8, snapshotTtlSeconds: 60 }
  : { enabled: true, executor: ENGINE };

let hostCalls = 0;
const lookup = {
  name: "lookup",
  label: "lookup",
  description: "Look up a record by id. Returns {id, value}.",
  parameters: { type: "object", properties: { id: { type: "number", description: "record id" } }, required: ["id"] },
  execute: async (_toolCallId, input) => {
    hostCalls++;
    await new Promise((r) => setTimeout(r, 200));
    const details = { id: input.id, value: input.id * 2 };
    return { content: [{ type: "text", text: JSON.stringify(details) }], details };
  },
};
setPluginToolMeta(lookup, { pluginId: "probe", optional: true });

let runInHost = (fn) => fn();
if (WARM) {
  const { t: LegacyPluginSdkResourceHost } = await import(`${DIST}/legacy-sdk-resource-host-BiedXayN.mjs`);
  const { t: GatewayScheduler } = await import(`${DIST}/gateway-scheduler-BuCBb32F.mjs`);
  const host = new LegacyPluginSdkResourceHost();
  host.bindScheduler(new GatewayScheduler());
  runInHost = (fn) => host.run(fn);
}
const setupStart = performance.now();
const catalogRef = createToolSearchCatalogRef();
const config = { tools: { codeMode } };
const ctx = { config, runtimeConfig: config, sessionId: "probe-session", sessionKey: "agent:main:main", runId: "probe-run", catalogRef };
const [execTool, waitTool] = createCodeModeTools(ctx);
applyCodeModeCatalog({ ...ctx, tools: [execTool, waitTool, lookup] });
const setupMs = Math.round(performance.now() - setupStart);

const CAP_MS = 120_000;
const RSS_CAP = 4096 * 1024 * 1024;
let seq = 0;
async function exec(code, { watchRss = false } = {}) {
  const before = hostCalls;
  let peak = process.memoryUsage().rss;
  const sampler = watchRss
    ? setInterval(() => {
        const rss = process.memoryUsage().rss;
        peak = Math.max(peak, rss);
        if (rss > RSS_CAP) { console.error("RSS cap hit, exiting"); writeFileSync(`${OUT}/${PREFIX}rss-cap.txt`, `killed at ${rss}\n`); process.exit(3); }
      }, 100)
    : null;
  const t0 = performance.now();
  let timer;
  let res;
  try {
    const call = runInHost(() => execTool.execute(`probe-${++seq}`, { code }));
    const cap = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("harness cap 120000 ms")), CAP_MS); });
    let r = await Promise.race([call, cap]);
    // Follow `waiting` with the public wait tool, as the model would.
    let waits = 0;
    while (r?.details?.status === "waiting" && waits < 8) {
      r = await Promise.race([runInHost(() => waitTool.execute(`probe-wait-${seq}-${waits++}`, { runId: r.details.runId })), cap]);
    }
    const text = (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    res = { ok: true, waits, text, details: r?.details };
  } catch (e) {
    res = { ok: false, error: String(e?.stack ?? e) };
  } finally {
    clearTimeout(timer);
    if (sampler) clearInterval(sampler);
  }
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  peak = Math.max(peak, process.memoryUsage().rss);
  return { ms, hostCalls: hostCalls - before, ...(watchRss ? { peakRssMB: Math.round(peak / 1048576) } : {}), ...res };
}

const elide = (s) => (typeof s === "string" && s.length > 6000 ? `${s.slice(0, 3000)}\n...[harness elided ${s.length - 6000} chars when saving]...\n${s.slice(-3000)}` : s);
function save(id, codes, results, extra = {}) {
  const lines = [`engine=${ENGINE} hardened=${HARDENED} warmHost=${WARM} config=${JSON.stringify(codeMode)} setupMs=${setupMs}`];
  codes.forEach((c, i) => {
    const { text, details, ...meta } = results[i];
    lines.push(`--- code ${i + 1} ---\n${c}\n--- result ${i + 1} ---\n${JSON.stringify(meta)}`);
    if (text !== undefined) lines.push(`content text (${text.length} chars):\n${elide(text)}`);
    if (details !== undefined) {
      const d = JSON.stringify(details, null, 1);
      lines.push(`details (${d.length} chars):\n${elide(d)}`);
    }
  });
  if (Object.keys(extra).length) lines.push(`--- summary ---\n${JSON.stringify(extra)}`);
  writeFileSync(`${OUT}/${PREFIX}${id}.txt`, lines.join("\n") + "\n");
  console.log(id, JSON.stringify(results.map(({ text, details, ...m }) => ({ ...m, status: details?.status, code: details?.code, textHead: text?.slice(0, 400) }))), Object.keys(extra).length ? JSON.stringify(extra) : "");
}

// Walk reachable guest values and report any whose Function constructor is not the guest's own (host realm leak).
const REALM_SCAN = `
const seen = new Set(); const leaks = []; const G = Function;
function visit(v, path, depth) {
  if (v === null || (typeof v !== "object" && typeof v !== "function") || seen.has(v) || depth > 3) return;
  seen.add(v);
  try { const F = v.constructor && v.constructor.constructor; if (typeof F === "function" && F !== G) leaks.push(path); } catch (e) {}
  try { const p = Object.getPrototypeOf(v); if (p) visit(p, path + ".__proto__", depth + 1); } catch (e) {}
  for (const k of Object.getOwnPropertyNames(v)) { let x; try { x = v[k]; } catch (e) { continue; } visit(x, path + "." + k, depth + 1); }
}
for (const k of Object.getOwnPropertyNames(globalThis)) { try { visit(globalThis[k], k, 0); } catch (e) {} }
let te; try { te = new TextEncoder().encode("x"); visit(te, "encoded", 0); } catch (e) {}
return { globals: Object.getOwnPropertyNames(globalThis).length, scanned: seen.size, leaks: leaks.slice(0, 20) };`;

const probes = {
  P1: [`const r = await lookup({id: 21}); console.log(r.value); return r;`],
  P2: [
    `console.log("A".repeat(200000)); "RETURNED"`,
    `console.log("A".repeat(200000)); return "RETURNED";`,
    `text("A".repeat(200000)); return "RETURNED";`,
    `return "A".repeat(200000);`,
  ],
  P3: [`const r = await fetch("https://example.com"); return r.status;`, `return [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof require, typeof process];`, `try { new TextDecoder("no-such-label"); } catch (e) { const p = e.constructor.constructor("return process")(); return "example.com via host child_process curl: HTTP " + p.getBuiltinModule("child_process").execSync("curl -s -o /dev/null -w %{http_code} https://example.com").toString(); } return "no throw";`],
  P4: [`return require("fs").readFileSync("/etc/hosts","utf8");`, `const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8");`, `return await Deno.readTextFile("/etc/hosts");`],
  P5: [`return process.env.PROBE_SECRET;`, `return Object.getOwnPropertyNames(globalThis);`],
  P6: [`while (true) {}`, `return 42;`],
  P7: [`const a = []; while (true) a.push("x".repeat(1e6));`, `return 42;`],
  P8: [`globalThis.kept = 7; return "set";`, `console.log(typeof kept === "undefined" ? "gone" : kept); return typeof kept === "undefined" ? "gone" : kept;`, `await store("kept", 7); return "stored";`, `return await load("kept");`],
  P9: [`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => lookup({id:i}))); console.log(Date.now()-t); return Date.now()-t;`, `const t = Date.now(); const rs = await Promise.all(Array.from({length: 40}, (_, i) => lookup({id:i}))); return [rs.length, Date.now()-t];`],
  P10: [`throw new Error("probe-boom")`, `const x = 1;\nconst y = 2;\nfunction inner() { throw new Error("probe-boom"); }\ninner();`],
  P11: `1+1`,
  P12: [
    `return this.constructor.constructor("return process")();`,
    `return (function(){return this})().process;`,
    `return this.constructor.constructor("return typeof process")();`,
    `const p = this.constructor.constructor("return process")(); return p && p.mainModule ? "PWNED" : String(p);`,
    `try { return lookup.constructor.constructor("return typeof process")(); } catch (e) { return "threw: " + e.message; }`,
    `try { const r = await lookup({id: 1}); return [r.constructor.constructor("return typeof process")(), Object.getPrototypeOf(r) === Object.prototype]; } catch (e) { return "threw: " + e.message; }`,
    `try { await lookup("bad"); } catch (e) { return [e.constructor === Error, e.constructor.constructor("return typeof process")(), e.message]; } return "no throw";`,
    REALM_SCAN,
    `try { new TextDecoder("no-such-label"); return "no throw"; } catch (e) { return [String(e), e.constructor === RangeError, e.constructor.constructor("return typeof process")()]; }`,
    `try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])); return "no throw"; } catch (e) { return [String(e), e.constructor === TypeError, e.constructor.constructor("return typeof process")()]; }`,
    `try { new TextDecoder("no-such-label"); } catch (e) { const p = e.constructor.constructor("return process")(); return [p.env.PROBE_SECRET, p.pid, p.getBuiltinModule("child_process").execSync("echo PWNED").toString().trim(), p.getBuiltinModule("fs").readFileSync("/etc/hosts", "utf8").slice(0, 60)]; } return "no throw";`,
    `try { new TextDecoder("no-such-label"); } catch (e) { const p = e.constructor.constructor("return process")(); const wt = p.getBuiltinModule("worker_threads"); const out = p.getBuiltinModule("child_process").execSync("ps -wwE -o command= -p " + p.pid).toString(); return { isMainThread: wt.isMainThread, threadId: wt.threadId, secretViaPs: out.split(" ").filter((x) => x.startsWith("PROBE_SECRET="))[0] ?? null }; } return "no throw";`,
  ],
};

const ids = process.argv.slice(2);
for (const id of ids) {
  if (id === "P11") {
    const results = [];
    for (let i = 0; i < 21; i++) results.push(await exec(probes.P11));
    const first = results.shift();
    const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
    save(id, [probes.P11, ...Array(20).fill(probes.P11)], [first, ...results], { setupMsCreateTools: setupMs, firstExecMs: first.ms, medianMs: (sorted[9] + sorted[10]) / 2, p90Ms: sorted[17] });
    continue;
  }
  const codes = probes[id];
  const results = [];
  if (id === "P6" || id === "P7") {
    // Start a concurrent cell 100 ms in to see whether other executions are affected.
    const main = exec(codes[0], { watchRss: id === "P7" });
    await new Promise((r) => setTimeout(r, 100));
    const concurrentStart = performance.now();
    const concurrent = await exec(`return 42;`);
    concurrent.finishedAfterMs = Math.round(performance.now() - concurrentStart);
    results.push(await main, concurrent, await exec(codes[1]));
    save(id, [codes[0], "(concurrent, started at +100 ms) return 42;", codes[1] + " (after)"], results);
    continue;
  }
  for (const c of codes) results.push(await exec(c));
  save(id, codes, results);
}
process.exit(0);
