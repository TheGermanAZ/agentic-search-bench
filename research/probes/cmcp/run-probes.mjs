// Runs SPEC probes P1-P12 against cmcp's execute tool over MCP stdio, no LLM.
// cmcp (Linux build) and the lookup server run inside one Docker container (node:24-bookworm-slim).
// Usage: node run-probes.mjs [--only P1,P2,...]   (P7 must go through research/probes/mem-lock.sh)
// cmcp exposes no limit options, so there is no hardened mode.
import { execSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpProc } from "./mcp-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "../../impls/cmcp/repo/target/release/cmcp");
const CALLS = join(HERE, "state/calls.log");
const OUT = join(HERE, "out");
const argv = process.argv.slice(2);
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
const want = (id) => !ONLY || ONLY.includes(id);
const calls = () => (existsSync(CALLS) ? readFileSync(CALLS, "utf8").trim().split("\n").filter(Boolean).length : 0);
let seq = 0;

function start() {
  const name = `cmcp-probe-${process.pid}-${seq++}`;
  const p = new McpProc("docker", ["run", "-i", "--rm", "--name", name, "-e", "PROBE_SECRET=s3cr3t", "-e", "HOME=/work/home", "-e", "RUST_LOG=info",
    "-v", `${HERE}:/work`, "-v", `${BIN}:/opt/cmcp:ro`, "-w", "/work", "node:24-bookworm-slim", "/opt/cmcp", "--config", "/work/state/config.toml", "serve"]);
  p.container = name;
  p.stop = () => { try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {} p.kill(); };
  return p;
}

const textOf = (resp) => { const c = resp?.result?.content; return Array.isArray(c) ? c.map((x) => x.text ?? JSON.stringify(x)).join("\n") : JSON.stringify(resp); };
function save(name, obj) { const f = join(OUT, name + ".txt"); writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)); console.log("wrote", f); }

async function single(p, id, code, timeoutMs = 125000, extra = {}) {
  const before = calls();
  const errBefore = p.stderr.length;
  const { resp, ms } = await p.call("execute", { code, ...extra }, timeoutMs);
  const t = textOf(resp);
  const jsLogs = p.stderr.slice(errBefore).split("\n").filter((l) => l.includes("[js]"));
  return { probe: id, code, args_extra: extra, wall_ms: Math.round(ms), host_calls: calls() - before, isError: resp?.result?.isError ?? null, response_text: t.slice(0, 4000), response_tail: t.slice(-300), response_text_length: t.length,
    console_on_proxy_stderr: jsLogs.map((l) => l.slice(0, 300)).slice(0, 10), raw_flags: { harnessTimeout: !!resp.harnessTimeout, transportClosed: !!resp.transportClosed, rpcError: resp.error ?? null } };
}

function cgroupBytes(name) {
  try { return Number(execFileSync("docker", ["exec", name, "cat", "/sys/fs/cgroup/memory.current"]).toString().trim()); } catch { return null; }
}

async function main() {
  let p = start();
  const t0 = performance.now();
  const initResp = await p.init();
  const tInit = performance.now() - t0;
  const list = await p.request("tools/list", {});
  const tReady = performance.now() - t0;

  if (want("setup")) {
    const s1 = await p.call("search", { code: 'return tools.filter(t => t.name.includes("look")).map(t => ({server: t.server, name: t.name}))' });
    const s2 = await p.call("search", { code: "return Object.keys(tools[0])" });
    const ts = await single(p, "ts-strip", "interface Foo { a: number }\nconst x: number = 21;\nconst f = (y: Foo): number => y.a * 2;\nreturn f({ a: x } as Foo);");
    const tsErr = await single(p, "ts-type-error-not-checked", 'const x: number = "not a number"; const r = await lookup.lookup({ idd: "wrong" } as any); return { x, typeofX: typeof x }');
    const tsWrongParam = await single(p, "ts-wrong-param-not-checked", "const r = await lookup.lookup({ nope: 1 }); return r");
    save("setup-typecheck", [tsErr, tsWrongParam]);
    save("setup", { init_ms: Math.round(tInit), ready_ms: Math.round(tReady), serverInfo: initResp.result?.serverInfo, instructions: initResp.result?.instructions, tools: list.result?.tools, search_filter: textOf(s1.resp), search_keys: textOf(s2.resp), ts_strip: ts });
  }
  if (want("P1")) {
    save("P1", [
      await single(p, "P1-spec", "const r = await lookup.lookup({id: 21}); console.log(r.value)"),
      await single(p, "P1-shape", "const r = await lookup.lookup({id: 21}); console.log(JSON.stringify(r)); return r"),
      await single(p, "P1-unwrapped", "const r = await lookup.lookup({id: 21}); return JSON.parse(r.content[0].text).value"),
    ]);
  }
  if (want("P2")) {
    save("P2", [
      await single(p, "P2-spec-form", 'console.log("A".repeat(200000)); "RETURNED"'),
      await single(p, "P2-return-form", 'console.log("A".repeat(200000)); return "RETURNED"'),
      await single(p, "P2-returned-200k", 'return "A".repeat(200000)'),
      await single(p, "P2-returned-200k-max_length-0", 'return "A".repeat(200000)', 125000, { max_length: 0 }),
    ]);
  }
  if (want("P2utf8")) {
    const r = await single(p, "P2-utf8-boundary", 'return "x" + "\\u20ac".repeat(20000)', 30000);
    r.proxy_exited = p.exited;
    r.after = p.exited ? null : await single(p, "P2-utf8-after", "return 'alive'", 30000);
    r.stderr_tail = p.stderr.slice(-1500);
    save("P2-utf8", r);
  }
  if (want("P7hog")) save("P7-hog", [
    await single(p, "P7hog-exec1", 'globalThis.hog = []; try { while (true) globalThis.hog.push("h".repeat(1e6)); } catch (e) { return "held " + globalThis.hog.length + " MB in a global: " + e.message }'),
    await single(p, "P7hog-exec2", 'return "y".repeat(5e6).length'),
    await single(p, "P7hog-exec3-tool-call", "const r = await lookup.lookup({id: 21}); return JSON.parse(r.content[0].text).value"),
  ]);
  if (want("P3")) save("P3", [
    await single(p, "P3-fetch", 'const r = await fetch("https://example.com"); return r.status'),
    await single(p, "P3-XMLHttpRequest", "return typeof XMLHttpRequest + ' ' + typeof WebSocket"),
  ]);
  if (want("P4")) save("P4", [
    await single(p, "P4-require", 'return require("fs").readFileSync("/etc/hosts","utf8")'),
    await single(p, "P4-import-fs", 'const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")'),
    await single(p, "P4-import-qjs-std", 'const std = await import("qjs:std"); return std.loadFile("/etc/hosts")'),
    await single(p, "P4-import-std", 'const std = await import("std"); return std.loadFile("/etc/hosts")'),
    await single(p, "P4-import-file", 'const m = await import("/etc/hosts"); return String(m)'),
    await single(p, "P4-Deno", 'return await Deno.readTextFile("/etc/hosts")'),
  ]);
  if (want("P5")) save("P5", [
    await single(p, "P5-process.env", "return process.env.PROBE_SECRET"),
    await single(p, "P5-globals", "return Object.getOwnPropertyNames(globalThis).filter(k => !/^[A-Z]/.test(k))"),
  ]);
  if (want("P8")) save("P8", [
    await single(p, "P8-exec1", "globalThis.kept = 7; return 'set'"),
    await single(p, "P8-exec2", 'console.log(typeof kept === "undefined" ? "gone" : kept); return typeof kept === "undefined" ? "gone" : kept'),
    await single(p, "P8-prototype-poison", "Array.prototype.map = function () { return ['poisoned by an earlier execution'] }; return 'poisoned'"),
    await single(p, "P8-prototype-victim", "return [1, 2, 3].map(x => x * 2)"),
  ]);
  if (want("P9")) save("P9", [
    await single(p, "P9-same-server", "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => lookup.lookup({id:i}))); console.log(Date.now()-t); return Date.now()-t"),
    await single(p, "P9-two-servers", "const t = Date.now(); await Promise.all([1,2,3,4].map(i => (i % 2 ? lookup : lookup2).lookup({id:i}))); return Date.now()-t"),
  ]);
  if (want("P10")) save("P10", [
    await single(p, "P10", 'throw new Error("probe-boom")'),
    await single(p, "P10-multiline", 'const a = 1;\nconst b = 2;\nthrow new Error("probe-boom on line 3")'),
    await single(p, "P10-syntax", "const = ;"),
    await single(p, "P10-tool-error", "return await nosuch.tool({})"),
  ]);
  if (want("P11")) {
    const ms = [];
    for (let i = 0; i < 20; i++) ms.push((await p.call("execute", { code: "return 1+1" })).ms);
    const s = [...ms].sort((a, b) => a - b);
    save("P11", { runs_ms: ms.map((x) => +x.toFixed(2)), median_ms: +((s[9] + s[10]) / 2).toFixed(2), p90_ms: +s[18].toFixed(2), one_time_setup_ms: { docker_run_to_initialize: Math.round(tInit), to_tools_list: Math.round(tReady) }, note: "round trip through docker run -i stdio; includes TS transpile of the generated declarations", uptime: execSync("uptime").toString().trim() });
  }
  if (want("P12")) save("P12", [
    await single(p, "P12-Function-ctor", 'return String(this.constructor.constructor("return typeof process")())'),
    await single(p, "P12-Function-ctor-process", 'return String(this.constructor.constructor("return process")())'),
    await single(p, "P12-sloppy-this", "return String((function(){return this})().process)"),
    await single(p, "P12-native-bridge", 'return typeof __call_tool + " " + typeof __stderr'),
    await single(p, "P12-import-os", 'const os = await import("os"); return os.exec(["/bin/sh","-c","echo PWNED"])'),
    await single(p, "P12-stderr-inject", '__stderr("\\n{\\"jsonrpc\\":\\"2.0\\",\\"method\\":\\"forged\\"}"); return "wrote to proxy stderr"'),
  ]);
  if (want("P6")) {
    const a = performance.now();
    const r = await single(p, "P6", "while (true) {}", 120000);
    r.wall_ms_until_stopped_or_harness_kill = Math.round(performance.now() - a);
    const ping = await p.request("ping", {}, 5000);
    r.ping_after = ping.harnessTimeout ? "no answer within 5 s" : ping;
    const other = await p.call("execute", { code: "return 'second request'" }, 5000);
    r.second_execute_after = other.resp.harnessTimeout ? "no answer within 5 s (proxy wedged)" : textOf(other.resp);
    save("P6", r);
    p.stop(); p = null;
  }
  if (want("P7")) {
    if (!p) { p = start(); await p.init(); }
    await single(p, "warm", "return 1");
    const base = cgroupBytes(p.container);
    let peak = base ?? 0, killed = false, lastMark = 0;
    const timeline = [];
    const a = performance.now();
    let sampling = true;
    (async () => {
      while (sampling) {
        const b = cgroupBytes(p.container);
        if (b != null) {
          if (b > peak) peak = b;
          const el = performance.now() - a;
          if (el - lastMark >= 1000) { lastMark = el; timeline.push([+(el / 1000).toFixed(1), Math.round(b / 1048576)]); }
          if (b > 4 * 1024 ** 3) { killed = true; p.stop(); }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    const r = await single(p, "P7", 'const a = []; while (true) a.push("x".repeat(1e6))', 120000);
    sampling = false;
    r.wall_ms = Math.round(performance.now() - a);
    r.container_cgroup_mb = { baseline: Math.round((base ?? 0) / 1048576), peak: Math.round(peak / 1048576) };
    r.timeline_s_mb = timeline;
    r.killed_by_harness_at_4GB = killed;
    if (r.raw_flags.harnessTimeout) { r.killed_by_harness_at_120s = true; p.stop(); }
    r.next_execution = p.exited ? { proxy_exited: p.exited } : await single(p, "P7-after", "return 'alive'", 30000);
    r.next_execution_alloc_small = p.exited ? null : await single(p, "P7-after-alloc", 'return "y".repeat(1e6).length', 30000);
    r.stderr_tail = p.stderr.slice(-1500);
    save("P7", r);
  }
  if (p) { save("stderr-" + (ONLY ? ONLY.join("_") : "all"), p.stderr.slice(-20000)); p.stop(); }
}
main().then(() => process.exit(0));
