// Runs SPEC probes P1-P12 against voidmcp's execute_code tool over MCP stdio, no LLM.
// Usage: node run-probes.mjs [--hardened] [--only P1,P2,...]
// P7 must be run separately through research/probes/mem-lock.sh (see README).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpProc } from "./mcp-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "../../impls/voidmcp/bin/voidmcp");
const STATE = join(HERE, "state");
const CALLS = join(STATE, "calls.log");
const OUT = join(HERE, "out");
const argv = process.argv.slice(2);
const HARDENED = argv.includes("--hardened");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
export const HARDENED_FLAGS = ["--timeout", "5s", "--memory", "8", "--max-tool-calls", "10", "--pool-size", "1"];
const FLAGS = HARDENED ? HARDENED_FLAGS : [];
const PFX = HARDENED ? "hardened-" : "";

const calls = () => (existsSync(CALLS) ? readFileSync(CALLS, "utf8").trim().split("\n").filter(Boolean).length : 0);

function start() {
  const p = new McpProc(BIN, ["serve", "--stdio", "--db", join(STATE, "voidmcp.db"), "--watch-interval", "0", ...FLAGS], {
    env: { ...process.env, HOME: STATE, PROBE_SECRET: "s3cr3t" },
  });
  return p;
}

function treeRssKB(rootPid) {
  const rows = execSync("ps -A -o pid=,ppid=,rss=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0; const stack = [rootPid];
  while (stack.length) { const p = stack.pop(); total += rss.get(p) || 0; for (const k of kids.get(p) || []) stack.push(k); }
  return total;
}

const exec = (p, code, timeoutMs) => p.call("execute_code", { code }, timeoutMs);

function save(name, obj) {
  const f = join(OUT, PFX + name + ".txt");
  writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  console.log("wrote", f);
}

function textOf(resp) {
  const c = resp?.result?.content;
  return Array.isArray(c) ? c.map((x) => x.text ?? JSON.stringify(x)).join("\n") : JSON.stringify(resp);
}

async function single(p, id, code, timeoutMs = 125000) {
  const before = calls();
  const { resp, ms } = await exec(p, code, timeoutMs);
  const rec = { probe: id, config: HARDENED ? HARDENED_FLAGS.join(" ") : "defaults", code, wall_ms: Math.round(ms), host_calls: calls() - before, isError: resp?.result?.isError ?? null, response_text: textOf(resp).slice(0, 4000), response_text_length: textOf(resp).length, raw_flags: { harnessTimeout: !!resp.harnessTimeout, transportClosed: !!resp.transportClosed } };
  return rec;
}

const want = (id) => !ONLY || ONLY.includes(id);

async function main() {
  let p = start();
  const tStart = performance.now();
  const initResp = await p.init();
  const tInit = performance.now() - tStart;
  const list = await p.request("tools/list", {});
  const tReady = performance.now() - tStart;
  if (want("setup")) {
    const search = await p.call("search", { query: "lookup" });
    const searchAll = await p.call("search", { query: "*" });
    save("setup", { init_ms: Math.round(tInit), ready_ms_incl_tools_list: Math.round(tReady), serverInfo: initResp.result?.serverInfo, tools: list.result?.tools?.map((t) => t.name), execute_code_description_chars: list.result?.tools?.find((t) => t.name === "execute_code")?.description.length, search_lookup: textOf(search.resp), search_star: textOf(searchAll.resp) });
  }

  if (want("P1")) save("P1", await single(p, "P1", "const r = await tools.lookup.lookup({id: 21}); console.log(r.value)"));
  if (want("P2")) {
    const a = await single(p, "P2-spec-form", 'console.log("A".repeat(200000)); "RETURNED"');
    const b = await single(p, "P2-return-form", 'console.log("A".repeat(200000)); return "RETURNED"');
    for (const r of [a, b]) {
      const { resp } = { resp: null };
    }
    const full = await exec(p, 'console.log("A".repeat(200000)); return "RETURNED"');
    const t = textOf(full.resp);
    let parsed = null; try { parsed = JSON.parse(t); } catch {}
    b.analysis = { total_response_chars: t.length, A_chars_returned: (t.match(/A/g) || []).length, result_field: parsed?.result, has_truncation_marker: /truncat/i.test(t) };
    save("P2", { spec_form: a, return_form: b });
  }
  if (want("P3")) {
    save("P3", [
      await single(p, "P3-fetch", 'const r = await fetch("https://example.com"); return r.status'),
      await single(p, "P3-std.urlGet", 'const std = await import("qjs:std"); return std.urlGet("https://example.com", {full: true})'),
      await single(p, "P3-XMLHttpRequest", "return typeof XMLHttpRequest + ' ' + typeof WebSocket"),
    ]);
  }
  if (want("P4")) {
    save("P4", [
      await single(p, "P4-require", 'return require("fs").readFileSync("/etc/hosts","utf8")'),
      await single(p, "P4-import-fs", 'const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")'),
      await single(p, "P4-Deno", 'return await Deno.readTextFile("/etc/hosts")'),
      await single(p, "P4-qjs-std-loadFile", 'const std = await import("qjs:std"); return std.loadFile("/etc/hosts")'),
      await single(p, "P4-qjs-std-open", 'const std = await import("qjs:std"); const e = {}; const f = std.open("/etc/hosts", "r", e); return f ? f.readAsString() : ("open failed errno " + e.errno)'),
      await single(p, "P4-qjs-os-readdir-root", 'const os = await import("qjs:os"); return {root: os.readdir("/"), parent: os.readdir("/.."), cwd: os.getcwd()}'),
      await single(p, "P4-qjs-std-write-sandbox-root", 'const std = await import("qjs:std"); const f = std.open("/probe-written.txt", "w"); f.puts("written-by-guest " + Date.now()); f.close(); const os = await import("qjs:os"); return os.readdir("/")'),
      await single(p, "P4-qjs-std-open-dotdot", 'const std = await import("qjs:std"); const e = {}; const f = std.open("../../../../../../etc/hosts", "r", e); return f ? f.readAsString() : ("open failed errno " + e.errno)'),
    ]);
  }
  if (want("P5")) {
    save("P5", [
      await single(p, "P5-process.env", "return process.env.PROBE_SECRET"),
      await single(p, "P5-qjs-std-getenv", 'const std = await import("qjs:std"); return {one: std.getenv("PROBE_SECRET"), all: std.getenviron()}'),
    ]);
  }
  if (want("P8")) {
    const a = await single(p, "P8-exec1", "globalThis.kept = 7; return 'set'");
    const b = await single(p, "P8-exec2", 'console.log(typeof kept === "undefined" ? "gone" : kept)');
    const c = await single(p, "P8-fs-exec1", 'const std = await import("qjs:std"); const f = std.open("/kept.txt", "w"); f.puts("7"); f.close(); return "wrote"');
    const d = await single(p, "P8-fs-exec2", 'const std = await import("qjs:std"); return std.loadFile("/kept.txt")');
    save("P8", [a, b, c, d]);
  }
  if (want("P9")) save("P9", await single(p, "P9", "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup.lookup({id:i}))); console.log(Date.now()-t)"));
  if (want("P9cap")) save("P9cap", await single(p, "P9cap", "let n = 0; try { for (let i = 0; i < 60; i++) { await tools.lookup.lookup({id: i}); n++; } } catch (e) { return 'stopped after ' + n + ': ' + e.message } return 'all ' + n"));
  if (want("P10")) {
    save("P10", [
      await single(p, "P10", 'throw new Error("probe-boom")'),
      await single(p, "P10-multiline", 'const a = 1;\nconst b = 2;\nthrow new Error("probe-boom on line 3")'),
      await single(p, "P10-syntax", "const = ;"),
    ]);
  }
  if (want("P11")) {
    const ms = [], dur = [];
    for (let i = 0; i < 20; i++) {
      const { resp, ms: m } = await exec(p, "return 1+1");
      ms.push(m);
      try { dur.push(JSON.parse(textOf(resp)).duration_ms); } catch {}
    }
    const s = [...ms].sort((a, b) => a - b);
    const q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
    save("P11", { runs_ms: ms.map((x) => +x.toFixed(2)), median_ms: +((s[9] + s[10]) / 2).toFixed(2), p90_ms: +q(0.9).toFixed(2), reported_duration_ms: dur, one_time_setup_ms: { spawn_to_initialize: Math.round(tInit), spawn_to_tools_list: Math.round(tReady) }, uptime: execSync("uptime").toString().trim() });
  }
  if (want("P12")) {
    save("P12", [
      await single(p, "P12-Function-ctor", 'return String(this.constructor.constructor("return process")())'),
      await single(p, "P12-globalThis-Function-ctor", 'return String(globalThis.constructor.constructor("return typeof process")())'),
      await single(p, "P12-Function-return-this", 'return String(Function("return this")().process)'),
      await single(p, "P12-sloppy-this", "return String((function(){return this})().process)"),
      await single(p, "P12-qjs-os-exec", 'const os = await import("qjs:os"); return os.exec(["/bin/sh", "-c", "echo PWNED"])'),
      await single(p, "P12-qjs-std-popen", 'const std = await import("qjs:std"); const f = std.popen("echo PWNED", "r"); return f.getline()'),
      await single(p, "P12-globals", "return Object.getOwnPropertyNames(globalThis).filter(k => !/^[A-Z]/.test(k))"),
      await single(p, "P12-bridge-direct", 'const b = Object.getOwnPropertyNames(globalThis).find(k => k.startsWith("__bridge_")); return b ? await globalThis[b]("lookup", "lookup", JSON.stringify({id: 5})) : "no bridge global"'),
      await single(p, "P12-std-reexposed", "return typeof std + ' ' + typeof os + ' ' + typeof bjson"),
    ]);
  }
  if (want("P6")) {
    const t0 = performance.now();
    const r = await single(p, "P6", "while (true) {}", 120000);
    r.wall_ms_until_stopped_or_harness_kill = Math.round(performance.now() - t0);
    // Is the server still answering other requests while the loop runs?
    const ping = await p.request("ping", {}, 5000);
    r.ping_after = ping.harnessTimeout ? "no answer within 5 s (server wedged)" : ping;
    r.proxy_alive = !p.exited;
    save("P6", r);
    if (r.raw_flags.harnessTimeout) { p.kill(); }
  }
  if (want("P7")) {
    if (p.exited) { p = start(); await p.init(); }
    const pid = p.proc.pid;
    const base = treeRssKB(pid);
    let peak = base, killedByHarness = false, lastMark = 0;
    const timeline = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      const r = treeRssKB(pid);
      if (r > peak) peak = r;
      const el = performance.now() - t0;
      if (el - lastMark >= 2000) { lastMark = el; timeline.push([Math.round(el / 1000), Math.round(r / 1024)]); }
      if (r > 4 * 1024 * 1024) { killedByHarness = true; p.kill(); }
    }, 50);
    const r = await single(p, "P7", 'const a = []; while (true) a.push("x".repeat(1e6))', 120000);
    clearInterval(timer);
    r.wall_ms = Math.round(performance.now() - t0);
    r.host_rss_tree_kb = { baseline: base, peak };
    r.rss_timeline_s_mb = timeline;
    r.killed_by_harness_at_4GB = killedByHarness;
    if (r.raw_flags.harnessTimeout) { p.kill(); r.killed_by_harness_at_120s = true; }
    const after = p.exited ? { proxy_exited: p.exited } : await single(p, "P7-after", "return 'alive'");
    r.next_execution = after;
    save("P7", r);
  }
  p.kill();
  if (p.stderr) writeFileSync(join(OUT, PFX + "stderr-" + (ONLY ? ONLY.join("_") : "all") + ".txt"), p.stderr.slice(-20000));
}
main().then(() => process.exit(0));
