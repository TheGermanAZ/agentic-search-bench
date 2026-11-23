import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, SRC } from "./client.mjs";

const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const serverPid = Number(readFileSync(join(SRC, "../server.pid"), "utf8"));

const rssMb = () => {
  try {
    return Math.round(Number(execSync(`ps -o rss= -p ${serverPid}`).toString().trim()) / 1024);
  } catch {
    return null;
  }
};
const cpu = () => {
  try {
    return Number(execSync(`ps -o %cpu= -p ${serverPid}`).toString().trim());
  } catch {
    return null;
  }
};
const alive = () => rssMb() !== null;

const save = (name, record) => {
  writeFileSync(join(out, `${name}.txt`), JSON.stringify(record, null, 2));
  const execution = record.response?.result?.structuredContent?.execution;
  console.log(
    name,
    record.wallMs ?? "",
    JSON.stringify(execution ?? record.response ?? record.note ?? record).slice(0, 400),
  );
};

const structured = (response) => response?.result?.structuredContent;
const hostCalls = (response) => structured(response)?.execution?.toolCalls?.length ?? null;

const run = async (session, name, code, extra = {}) => {
  const started = Date.now();
  const response = await session.execute(code);
  const wallMs = Date.now() - started;
  const record = { probe: name, code, wallMs, hostToolCalls: hostCalls(response), response, ...extra };
  save(name, record);
  return record;
};

const probes = {
  async P1(s) {
    await run(s, "P1", "const r = await tools.probe.lookup({id: 21}); console.log(r.value)");
  },
  async P2(s) {
    const r = await run(s, "P2", 'console.log("A".repeat(200000)); "RETURNED"');
    const e = structured(r.response)?.execution;
    const text = r.response?.result?.content?.[0]?.text ?? "";
    writeFileSync(
      join(out, "P2.summary.txt"),
      JSON.stringify(
        {
          value: e?.value,
          logLines: e?.logs?.length,
          firstLogChars: e?.logs?.[0]?.length,
          truncatedFlag: e?.truncated ?? null,
          textContentChars: text.length,
          textContainsFullPrint: text.includes("A".repeat(200000)),
        },
        null,
        2,
      ),
    );
    // Shrink the saved file: keep shape, not 400 KB of As.
    const full = JSON.parse(readFileSync(join(out, "P2.txt"), "utf8"));
    full.response.result.content[0].text = `<${text.length} chars, see P2.summary.txt>`;
    full.response.result.structuredContent.execution.logs = [`<${e?.logs?.[0]?.length} chars of A>`];
    writeFileSync(join(out, "P2.txt"), JSON.stringify(full, null, 2));
  },
  async P3(s) {
    await run(s, "P3", 'await fetch("https://example.com")');
  },
  async P4(s) {
    await run(s, "P4a", 'require("fs").readFileSync("/etc/hosts","utf8")');
    await run(s, "P4b", 'const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")');
    await run(s, "P4c", 'await Deno.readTextFile("/etc/hosts")');
  },
  async P5(s) {
    await run(s, "P5", "process.env.PROBE_SECRET");
    const env = execSync(`ps eww -o command= -p ${serverPid}`).toString();
    writeFileSync(join(out, "P5.host-env-check.txt"), `server pid ${serverPid} has PROBE_SECRET=s3cr3t in env: ${env.includes("PROBE_SECRET=s3cr3t")}\n`);
  },
  async P6(s) {
    // SPEC: stop the harness at 120 s. Meanwhile check whether other executions still get served.
    const controller = new AbortController();
    const started = Date.now();
    const pending = s.execute("while (true) {}", controller.signal).then(
      (response) => ({ response, wallMs: Date.now() - started }),
      (error) => ({ error: String(error), wallMs: Date.now() - started }),
    );
    await new Promise((r) => setTimeout(r, 5000));
    const other = await connect();
    const t = Date.now();
    const side = await other.execute("1+1");
    const sideMs = Date.now() - t;
    const cpuDuring = cpu();
    const timer = setTimeout(() => controller.abort(), 120_000 - (Date.now() - started));
    const result = await pending;
    clearTimeout(timer);
    await new Promise((r) => setTimeout(r, 5000));
    const cpuAfterAbort = cpu();
    const record = {
      probe: "P6",
      code: "while (true) {}",
      ...result,
      stoppedByHarnessAt120s: "error" in result,
      concurrentExecuteDuringLoop: { code: "1+1", ms: sideMs, value: structured(side)?.execution?.value },
      serverCpuPercentDuringLoop: cpuDuring,
      serverCpuPercent5sAfterClientAbort: cpuAfterAbort,
    };
    save("P6", record);
  },
  async P6long(s) {
    // Not in SPEC: let the documented 5 minute default run out.
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 360_000);
    const response = await s.execute("let n = 0; while (true) { n++ }", controller.signal).catch((e) => ({ error: String(e) }));
    clearTimeout(timer);
    const record = { probe: "P6long", code: "let n = 0; while (true) { n++ }", wallMs: Date.now() - started, response };
    await new Promise((r) => setTimeout(r, 3000));
    record.serverCpuPercent3sAfter = cpu();
    save("P6long", record);
  },
  async P7(s) {
    const samples = [];
    let peak = rssMb();
    const started = Date.now();
    const controller = new AbortController();
    const pending = s
      .execute('const a = []; while (true) a.push("x".repeat(1e6))', controller.signal)
      .then((response) => ({ response }), (error) => ({ error: String(error) }));
    let reason = null;
    while (reason === null) {
      const done = await Promise.race([pending.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
      const rss = rssMb();
      samples.push({ t: Date.now() - started, rssMb: rss });
      if (rss !== null && rss > peak) peak = rss;
      if (done) reason = "returned";
      else if (rss === null) reason = "server-process-gone";
      else if (rss > 4096) reason = "harness-kill-4GB";
      else if (Date.now() - started > 120_000) reason = "harness-kill-120s";
    }
    if (reason.startsWith("harness-kill")) {
      controller.abort();
      execSync(`kill -9 ${serverPid}`);
    }
    const result = await Promise.race([pending, new Promise((r) => setTimeout(() => r({ note: "no response" }), 5000))]);
    save("P7", { probe: "P7", code: 'const a = []; while (true) a.push("x".repeat(1e6))', wallMs: Date.now() - started, reason, peakRssMb: peak, serverAlive: alive(), ...result, samples });
  },
  async P8(s) {
    await run(s, "P8-exec1-globalThis", "globalThis.kept = 7");
    await run(s, "P8-exec1-var", "var kept = 7; kept");
    await run(s, "P8-exec2", 'console.log(typeof kept === "undefined" ? "gone" : kept)');
  },
  async P9(s) {
    await run(s, "P9", "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.probe.lookup({id:i}))); console.log(Date.now()-t)");
  },
  async P10(s) {
    await run(s, "P10", 'throw new Error("probe-boom")');
    await run(s, "P10b", 'function inner() { throw new Error("probe-boom") }\nconst x = 1;\ninner()');
  },
  async P11() {
    const t0 = Date.now();
    const s = await connect();
    const initMs = Date.now() - t0;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t = Date.now();
      const r = await s.execute("1+1");
      times.push(Date.now() - t);
      if (structured(r)?.execution?.value !== 2) throw new Error(JSON.stringify(r));
    }
    const sorted = [...times].sort((a, b) => a - b);
    const record = {
      probe: "P11",
      code: "1+1",
      mcpInitializeMs: initMs,
      timesMs: times,
      medianMs: (sorted[9] + sorted[10]) / 2,
      p90Ms: sorted[17],
      note: "Each execute is a separate HTTP round trip to the local server over loopback; one MCP session for all 20.",
    };
    save("P11", record);
  },
  async P12(s) {
    await run(s, "P12a", 'this.constructor.constructor("return process")()');
    await run(s, "P12b", "(function(){return this})().process");
    await run(s, "P12c", '({}).constructor.constructor("return process")()');
    await run(s, "P12d", '[].map.constructor("return process")()');
    await run(s, "P12e", 'tools.constructor.constructor("return process")()');
    await run(s, "P12f", 'const p = tools.probe.lookup({id:1}); return p.constructor.constructor("return process")()');
    await run(s, "P12g", 'Object.getPrototypeOf(async function(){}).constructor("return process")()');
    await run(s, "P12h", 'const o = {}; o.__proto__.polluted = 1; return [({}).polluted, Object.keys(Object)]');
    await run(s, "P12i", 'const r = await tools.probe.lookup({id:1}); return [r.constructor === Object, typeof r.constructor, Object.getPrototypeOf(r)]');
  },
  async LIMIT_calls(s) {
    await run(s, "L-calls-100", "const r = await Promise.all(Array.from({length: 100}, (_, i) => tools.probe.lookup({id: i}))); return r.length");
    await run(s, "L-calls-101", "const r = await Promise.all(Array.from({length: 101}, (_, i) => tools.probe.lookup({id: i}))); return r.length");
    await run(
      s,
      "L-calls-catch",
      "let ok = 0; let err = null; for (let i = 0; i < 150; i++) { try { await tools.probe.lookup({id: i}); ok++ } catch (e) { err = String(e.message); break } } return { ok, err }",
    );
    await run(s, "L-calls-search", 'await tools.search({query: "lookup"}); const r = await Promise.all(Array.from({length: 100}, (_, i) => tools.probe.lookup({id: i}))); return r.length');
  },
  async LIMIT_source(s) {
    const pad = (n) => {
      const head = "return 1;\n//";
      return head + "x".repeat(n - head.length);
    };
    for (const n of [65_536, 65_537]) {
      const code = pad(n);
      const started = Date.now();
      const response = await s.execute(code);
      save(`L-source-${n}`, { probe: `L-source-${n}`, codeChars: code.length, wallMs: Date.now() - started, response });
    }
  },
  async LIMIT_globals(s) {
    await run(s, "L-globals", "return [typeof setTimeout, typeof setInterval, typeof queueMicrotask, typeof globalThis, typeof Function, typeof eval, typeof WebAssembly, typeof SharedArrayBuffer, typeof Atomics, typeof Proxy, typeof Reflect, typeof Buffer, typeof crypto, typeof structuredClone, typeof Date.now]");
    await run(s, "L-async-recursion", "async function f(n) { return await f(n + 1) } await f(0)");
  },
  async CRASH_recursion(s) {
    const code = "function f(n) { return f(n + 1) } f(0)";
    const started = Date.now();
    let peak = rssMb();
    const pending = s.execute(code).then((response) => ({ response }), (error) => ({ error: String(error) }));
    for (;;) {
      const done = await Promise.race([pending.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
      const rss = rssMb();
      if (rss !== null && rss > peak) peak = rss;
      if (done || rss === null || Date.now() - started > 120_000) break;
    }
    const result = await Promise.race([pending, new Promise((r) => setTimeout(() => r({ note: "no response" }), 5000))]);
    save("L-sync-recursion", { probe: "L-sync-recursion", code, wallMs: Date.now() - started, peakRssMb: peak, serverAliveAfter: alive(), ...result });
  },
  async APPROVAL() {
    // model mode returns approval-required and expects resume.
    const s = await connect("?elicitation_mode=model");
    const started = Date.now();
    const first = await s.execute("const t0 = Date.now(); const a = await tools.probe.gated({id: 5}); const b = await tools.probe.lookup({id: 6}); return { a, b, programSawMs: Date.now() - t0 }");
    const firstMs = Date.now() - started;
    const pending = structured(first);
    save("A-approval-pause", { probe: "A-approval-pause", wallMs: firstMs, response: first });
    const requestId = pending?.requestId ?? pending?.request?.id ?? pending?.interaction?.id ?? JSON.stringify(pending).match(/(apr|elc)_[0-9a-f-]{36}/)?.[0];
    const waitMs = Number(process.env.PROBE_APPROVAL_WAIT_MS ?? 2000);
    await new Promise((r) => setTimeout(r, waitMs));
    const t = Date.now();
    const resumed = await s.tool("resume", { requestId, response: { action: "accept", content: {} } });
    save("A-approval-resume", { probe: "A-approval-resume", requestId, waitedBeforeResumeMs: waitMs, wallMs: Date.now() - t, response: resumed });
    const auto = await connect();
    await run(auto, "A-approval-automatic-mode", "return await tools.probe.gated({id: 5})");
  },
};

const selected = process.argv.slice(2);
const session = await connect();
for (const name of selected.length > 0 ? selected : Object.keys(probes)) {
  if (!alive()) {
    console.log("server not running; stopping before", name);
    break;
  }
  await probes[name](session);
}
