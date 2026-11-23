import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, deploy, SERVER_PID } from "./hardened-client.mjs";

const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const ps = (field) => {
  try {
    const value = execSync(`ps -o ${field}= -p ${SERVER_PID}`).toString().trim();
    return value === "" ? null : Number(value);
  } catch {
    return null;
  }
};
const rssMb = () => {
  const kb = ps("rss");
  return kb === null ? null : Math.round(kb / 1024);
};
const alive = () => ps("rss") !== null;
const structured = (response) => response?.result?.structuredContent;
const execution = (response) => structured(response)?.execution;
const hostCalls = (response) => execution(response)?.toolCalls?.length ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const save = (name, record) => {
  writeFileSync(join(out, `hardened-${name}.txt`), JSON.stringify(record, null, 2));
  console.log(`hardened-${name}`, record.wallMs ?? "", JSON.stringify(execution(record.response) ?? record.response ?? record).slice(0, 300));
};

const run = async (session, name, code) => {
  const started = Date.now();
  const response = await session.execute(code);
  const record = { probe: name, serverPid: SERVER_PID, code, wallMs: Date.now() - started, hostToolCalls: hostCalls(response), response };
  save(name, record);
  return record;
};

const trivialAfter = async (session) => {
  const t = Date.now();
  const same = await session.execute("1+1").catch((e) => ({ error: String(e) }));
  const sameMs = Date.now() - t;
  const fresh = await connect().catch((e) => ({ error: String(e) }));
  const t2 = Date.now();
  const other = fresh.execute ? await fresh.execute("1+1").catch((e) => ({ error: String(e) })) : fresh;
  return {
    sameSession: { code: "1+1", ms: sameMs, value: execution(same)?.value, raw: execution(same) ?? same },
    newSession: { code: "1+1", ms: Date.now() - t2, value: execution(other)?.value, raw: execution(other) ?? other },
    serverAlive: alive(),
    serverRssMbAfter: rssMb(),
  };
};

const probes = {
  async DEPLOY() {
    const res = await deploy();
    writeFileSync(join(out, "hardened-deploy.txt"), `${res.status}\n${res.body.slice(0, 4000)}\n`);
    console.log("deploy", res.status, res.body.slice(0, 300));
  },
  async P1(s) {
    await run(s, "P1", "const r = await tools.probe.lookup({id: 21}); console.log(r.value)");
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
    const record = await run(s, "P5", "process.env.PROBE_SECRET");
    record.serverHasProbeSecretInEnv = execSync(`ps eww -o command= -p ${SERVER_PID}`).toString().includes("PROBE_SECRET=s3cr3t");
    save("P5", record);
  },
  async P6(s) {
    const code = "while (true) {}";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const started = Date.now();
    const pending = s.execute(code, controller.signal).then(
      (response) => ({ response, wallMs: Date.now() - started }),
      (error) => ({ error: String(error), wallMs: Date.now() - started }),
    );
    await sleep(3000);
    const cpuDuring = ps("%cpu");
    const result = await pending;
    clearTimeout(timer);
    await sleep(3000);
    save("P6", {
      probe: "P6",
      serverPid: SERVER_PID,
      code,
      ...result,
      stoppedByHarnessAt120s: "error" in result,
      serverCpuPercentDuringLoop: cpuDuring,
      serverCpuPercent3sAfterReturn: ps("%cpu"),
      after: await trivialAfter(s),
    });
  },
  async P7(s) {
    const code = 'const a = []; while (true) a.push("x".repeat(1e6))';
    const samples = [];
    const rssBefore = rssMb();
    let peak = rssBefore;
    const started = Date.now();
    const controller = new AbortController();
    const pending = s.execute(code, controller.signal).then(
      (response) => ({ response }),
      (error) => ({ error: String(error) }),
    );
    let reason = null;
    while (reason === null) {
      const done = await Promise.race([pending.then(() => true), sleep(500).then(() => false)]);
      const rss = rssMb();
      samples.push({ t: Date.now() - started, rssMb: rss });
      if (rss !== null && rss > peak) peak = rss;
      if (done) reason = "returned";
      else if (rss === null) reason = "server-process-gone";
      else if (rss > 4096) reason = "harness-kill-4GB";
      else if (Date.now() - started > 120_000) reason = "harness-kill-120s";
    }
    const wallMs = Date.now() - started;
    if (reason.startsWith("harness-kill")) {
      controller.abort();
      execSync(`kill -9 -${SERVER_PID}`);
    }
    const result = await Promise.race([pending, sleep(5000).then(() => ({ note: "no response" }))]);
    await sleep(2000);
    save("P7", {
      probe: "P7",
      serverPid: SERVER_PID,
      code,
      wallMs,
      reason,
      rssMbBefore: rssBefore,
      peakRssMb: peak,
      ...result,
      after: await trivialAfter(s),
      samples,
    });
  },
  async P9(s) {
    await run(s, "P9", "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.probe.lookup({id:i}))); console.log(Date.now()-t)");
  },
  async P12(s) {
    await run(s, "P12a", 'this.constructor.constructor("return process")()');
    await run(s, "P12b", "(function(){return this})().process");
    await run(s, "P12c", '({}).constructor.constructor("return process")()');
    await run(s, "P12d", '[].map.constructor("return process")()');
    await run(s, "P12e", 'tools.constructor.constructor("return process")()');
    await run(s, "P12f", 'const p = tools.probe.lookup({id:1}); return p.constructor.constructor("return process")()');
    await run(s, "P12g", 'Object.getPrototypeOf(async function(){}).constructor("return process")()');
    await run(s, "P12h", "const o = {}; o.__proto__.polluted = 1; return [({}).polluted, Object.keys(Object)]");
    await run(s, "P12i", "const r = await tools.probe.lookup({id:1}); return [r.constructor === Object, typeof r.constructor, Object.getPrototypeOf(r)]");
  },
  async LIMIT_calls(s) {
    // Checks the server honors EXECUTOR_MCP_MAX_TOOL_CALLS=10: the 11th call should be refused.
    await run(
      s,
      "L-calls-11",
      "let ok = 0; let err = null; for (let i = 0; i < 11; i++) { try { await tools.probe.lookup({id: i}); ok++ } catch (e) { err = String(e.message); break } } return { ok, err }",
    );
  },
  async CRASH_recursion(s) {
    // Wave 1 crashed the default server with this in 31 s; checks whether a 10 s budget beats it.
    const code = "function f(n) { return f(n + 1) } f(0)";
    const started = Date.now();
    let peak = rssMb();
    const controller = new AbortController();
    const pending = s.execute(code, controller.signal).then((response) => ({ response }), (error) => ({ error: String(error) }));
    let reason = null;
    while (reason === null) {
      const done = await Promise.race([pending.then(() => true), sleep(500).then(() => false)]);
      const rss = rssMb();
      if (rss !== null && rss > peak) peak = rss;
      if (done) reason = "returned";
      else if (rss === null) reason = "server-process-gone";
      else if (rss > 4096) reason = "harness-kill-4GB";
      else if (Date.now() - started > 120_000) reason = "harness-kill-120s";
    }
    const wallMs = Date.now() - started;
    if (reason.startsWith("harness-kill")) {
      controller.abort();
      execSync(`kill -9 -${SERVER_PID}`);
    }
    const result = await Promise.race([pending, sleep(5000).then(() => ({ note: "no response" }))]);
    save("L-sync-recursion", { probe: "L-sync-recursion", serverPid: SERVER_PID, code, wallMs, reason, peakRssMb: peak, ...result, after: await trivialAfter(s) });
  },
};

const session = await connect();
for (const name of process.argv.slice(2)) {
  if (!alive()) {
    console.log("server not running; stopping before", name);
    break;
  }
  await probes[name](session);
}
