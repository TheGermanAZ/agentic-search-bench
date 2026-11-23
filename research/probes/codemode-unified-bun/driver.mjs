// Runs ONE probe against CodeMode Unified through its MCP server entry point (dist/mcp-server.js,
// tool `execute_code` with a `runtime` argument), the path its README gives for Claude Code.
// Usage: node driver.mjs <bun|quickjs|deno|isolated-vm|e2b> <probe> <default|hardened>
// Prints "@@start" when the probe begins and the JSON record as the last stdout line.
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const [runtime, probe, mode = 'default'] = process.argv.slice(2);
const HERE = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../impls/codemode-unified-bun/repo/', import.meta.url).pathname;
const SDK = REPO + 'node_modules/@modelcontextprotocol/sdk/dist/';
const { Client } = await import(SDK + 'client/index.js');
const { StdioClientTransport } = await import(SDK + 'client/stdio.js');

const OUT = new URL(`../codemode-unified-${runtime}/out/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const countFile = `${OUT}calls-${mode}-${probe}.jsonl`;
writeFileSync(countFile, '');
const configPath = `${OUT}mcp-config-${mode}-${probe}.json`;
writeFileSync(
  configPath,
  JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [HERE + 'lookup-server.mjs', countFile] } } }, null, 2),
);

const hostCalls = () => (existsSync(countFile) ? readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const HARDENED_TIMEOUT_MS = 5000;

async function startServer({ mcpIntegration = true } = {}) {
  const t0 = performance.now();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [REPO + 'dist/mcp-server.js'],
    // HOME points at a folder whose .deno/bin and .bun/bin hold symlinks to the installed binaries,
    // because the runtimes look only at $HOME/.deno/bin/deno and $HOME/.bun/bin/bun (see README).
    env: {
      PATH: process.env.PATH,
      HOME: HERE + 'home',
      MCP_CONFIG_PATH: configPath,
      CODEMODE_ENABLE_MCP_INTEGRATION: mcpIntegration ? 'true' : 'false',
      PROBE_SECRET: 's3cr3t',
    },
  });
  transport.onerror = (e) => transportErrors.push(String(e && e.message ? e.message : e).slice(0, 300));
  const client = new Client({ name: 'probe-driver', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const tools = await client.listTools();
  return { client, tools, setupMs: performance.now() - t0, close: () => client.close().catch(() => {}) };
}

const transportErrors = [];
const main = await startServer();
const { client, setupMs } = main;
const executeTool = main.tools.tools.find((t) => t.name === 'execute_code');

async function run(code, srv = main) {
  const before = hostCalls();
  const s = performance.now();
  let out;
  let threw = null;
  const args = { code, runtime, ...(mode === 'hardened' ? { timeout: HARDENED_TIMEOUT_MS } : {}) };
  try {
    const res = await srv.client.callTool({ name: 'execute_code', arguments: args });
    const text = res.content?.map((c) => c.text).join('\n') ?? '';
    try {
      out = JSON.parse(text);
    } catch {
      out = { rawText: text.slice(0, 2000), isError: res.isError };
    }
  } catch (e) {
    threw = String(e && e.message ? e.message : e).slice(0, 2000);
  }
  return { code, wallMs: +(performance.now() - s).toFixed(1), hostCalls: hostCalls() - before, out: clip(out), threw };
}

// One execution on a new server process, for the quickjs runtime: its pooled contexts keep the injected
// `const` declarations, so every later run in the same context fails with a redeclaration error.
async function fresh(code, opts) {
  const srv = await startServer(opts);
  const r = await run(code, srv);
  await srv.close();
  return { ...r, freshServer: true, mcpIntegration: opts?.mcpIntegration ?? true };
}

function clip(out) {
  if (!out || typeof out !== 'object') return out;
  const c = { ...out };
  if (Array.isArray(c.logs)) {
    c.logs = c.logs.map((l) => (typeof l === 'string' && l.length > 300 ? { length: l.length, head: l.slice(0, 80), tail: l.slice(-80) } : l));
  }
  if (typeof c.result === 'string' && c.result.length > 300) c.result = { length: c.result.length, head: c.result.slice(0, 80) };
  if (c.error && typeof c.error.message === 'string' && c.error.message.length > 1500) {
    c.error = { ...c.error, message: c.error.message.slice(0, 1500) + `...[${c.error.message.length} chars]` };
  }
  return c;
}

const T = 'mcp.probe.lookup';
const probes = {
  async P1() {
    return {
      spec: await run(`const r = await ${T}({id: 21}); console.log(r.value)`),
      parsedField: await run(`const r = await ${T}({id: 21}); console.log(JSON.stringify(r.parsed)); return r.parsed && r.parsed.value`),
    };
  },
  async P2() {
    return {
      literalSpecForm: await run(`console.log("A".repeat(200000)); "RETURNED"`),
      returnForm: await run(`console.log("A".repeat(200000)); return "RETURNED"`),
    };
  },
  async P3() {
    return run(`const r = await fetch("https://example.com"); return { status: r.status, bytes: (await r.text()).length }`);
  },
  async P4() {
    return {
      require: await run(`return require("fs").readFileSync("/etc/hosts","utf8").slice(0, 60)`),
      dynamicImport: await run(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8").slice(0, 60)`),
      denoReadTextFile: await run(`return (await Deno.readTextFile("/etc/hosts")).slice(0, 60)`),
      bunFile: await run(`return (await Bun.file("/etc/hosts").text()).slice(0, 60)`),
    };
  },
  async P5() {
    return {
      spec: await run(`return process.env.PROBE_SECRET`),
      denoEnv: await run(`return Deno.env.get("PROBE_SECRET")`),
    };
  },
  async P6() {
    return run(`while (true) {}`);
  },
  async P7() {
    const probeRun = await run(`const a = []; while (true) a.push("x".repeat(1e6))`);
    const survivalCheck = await run(`return 1+1`);
    return { probe: probeRun, survivalCheck };
  },
  async P8() {
    return {
      first: await run(`globalThis.kept = 7; return "set"`),
      second: await run(`console.log(typeof kept === "undefined" ? "gone" : kept); return typeof kept === "undefined" ? "gone" : kept`),
    };
  },
  async P9() {
    return run(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => ${T}({id:i}))); console.log(Date.now()-t)`);
  },
  async P10() {
    return {
      spec: await run(`throw new Error("probe-boom")`),
      multiLine: await run(`const x = 1;\nconst y = 2;\nthrow new Error("probe-boom-line3");`),
    };
  },
  async P11() {
    const first = await run(`1+1`);
    const times = [];
    for (let i = 0; i < 20; i++) times.push((await run(`1+1`)).wallMs);
    const sorted = [...times].sort((a, b) => a - b);
    return {
      oneTimeSetupMs: +setupMs.toFixed(1),
      oneTimeSetupCovers: 'spawn dist/mcp-server.js, MCP initialize, MCP manager connecting the lookup server, tools/list',
      firstExecutionMs: first.wallMs,
      firstResult: first.out,
      medianMs: sorted[10],
      p90Ms: sorted[17],
      samples: times,
    };
  },
  async P12() {
    const attempts = {
      A_functionCtor: `return String(this.constructor.constructor("return process")())`,
      B_sloppyThis: `return String((function(){ return this })().process)`,
      C_typeofs: `return [typeof process, typeof require, typeof Deno, typeof Bun, typeof fetch].join(",")`,
      D_exec_node: `const p = Function("return process")(); return p.getBuiltinModule("child_process").execSync("echo PWNED; id -un").toString()`,
      E_exec_bun: `return Bun.spawnSync(["sh","-c","echo PWNED; id -un"]).stdout.toString()`,
      F_exec_deno: `const o = await new Deno.Command("sh", { args: ["-c", "echo PWNED; id -un"] }).output(); return new TextDecoder().decode(o.stdout)`,
    };
    const rows = {};
    for (const [k, code] of Object.entries(attempts)) rows[k] = await run(code);
    return rows;
  },
  async P15_discovery() {
    // Extra: the on-demand discovery path the execute_code description points the model to.
    let resource = null;
    let resourceError = null;
    try {
      resource = await client.readResource({ uri: 'mcp://types/declarations' });
    } catch (e) {
      resourceError = String(e && e.message ? e.message : e).slice(0, 500);
    }
    const resources = await client.listResources().catch((e) => ({ error: String(e) }));
    return { executeCodeDescription: executeTool?.description, resources, resource, resourceError };
  },
  async P14_credentials() {
    // Extra: the MCP config (which holds every downstream server's env, often API keys) is named in the
    // server's env, which the bun child inherits. The config read here lives inside this repo's out/ dir.
    return run(`const p = process.env.MCP_CONFIG_PATH; return { path: p, config: JSON.parse(require("fs").readFileSync(p, "utf8")) }`);
  },
  async P13_twoPass() {
    // Extra: tool calls whose arguments depend on an earlier tool result, and side effects in a program that calls tools.
    return {
      dependentCalls: await run(`const a = await ${T}({id: 1}); const b = await ${T}({id: a.parsed ? a.parsed.value : -1}); return { a: a.parsed, b: b.parsed }`),
      fileSideEffect: await (async () => {
        const marker = `${OUT}twopass-side-effect-${mode}.txt`;
        writeFileSync(marker, '');
        const r = await run(`require("fs").appendFileSync(${JSON.stringify(marker)}, "program-ran\\n"); const r = await ${T}({id: 4}); return r.parsed`);
        return { ...r, timesProgramRan: readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length };
      })(),
      sideEffectCount: await run(`globalThis.__n = (globalThis.__n || 0) + 1; console.log("program-ran"); const r = await ${T}({id: 3}); return r.parsed`),
    };
  },
};

// The quickjs runtime evaluates the program as a plain global script (no async wrapper, no console,
// no top-level return or await) and returns the value of the last expression, so its probes use that form.
const NO_MCP = { mcpIntegration: false };
const qjsProbes = {
  async P1() {
    return {
      spec: await fresh(`const r = await ${T}({id: 21}); console.log(r.value)`),
      expressionForm: await fresh(`${T}({id: 21})`),
      typeofConsole: await fresh(`typeof console`),
    };
  },
  async P2() {
    return {
      returnValueOnly: await fresh(`var big = "A".repeat(200000); big`),
      literalSpecForm: await fresh(`console.log("A".repeat(200000)); "RETURNED"`),
    };
  },
  async P3() {
    return { typeofFetch: await fresh(`typeof fetch`), spec: await fresh(`fetch("https://example.com")`) };
  },
  async P4() {
    return {
      require: await fresh(`require("fs").readFileSync("/etc/hosts","utf8")`),
      dynamicImport: await fresh(`import("fs")`),
      typeofs: await fresh(`[typeof require, typeof Deno, typeof Bun, typeof std, typeof os].join(",")`),
    };
  },
  async P5() {
    return { spec: await fresh(`process.env.PROBE_SECRET`), typeofProcess: await fresh(`typeof process`) };
  },
  async P6() {
    return run(`while (true) {}`);
  },
  async P7() {
    const probeRun = await run(`var a = []; while (true) a.push("x".repeat(1e6))`);
    const sameServerAfter = await run(`1+1`);
    return { probe: probeRun, sameServerAfter };
  },
  async P8() {
    const srv = await startServer(NO_MCP);
    const standalone = { first: await run(`globalThis.kept = 7; "set"`, srv), second: await run(`typeof kept === "undefined" ? "gone" : kept`, srv) };
    await srv.close();
    return {
      standaloneMode: standalone,
      mcpIntegrationMode: { first: await run(`globalThis.kept = 7; "set"`), second: await run(`typeof kept === "undefined" ? "gone" : kept`) },
    };
  },
  async P9() {
    return fresh(`Promise.all([1,2,3,4,5].map(i => ${T}({id:i})))`);
  },
  async P10() {
    return {
      spec: await fresh(`throw new Error("probe-boom")`),
      multiLine: await fresh(`var x = 1;\nvar y = 2;\nthrow new Error("probe-boom-line3");`),
      stackProperty: await fresh(`try { null.x } catch (e) { e.stack }`),
    };
  },
  async P11() {
    const srv = await startServer(NO_MCP);
    const first = await run(`1+1`, srv);
    const times = [];
    const results = [];
    for (let i = 0; i < 20; i++) {
      const r = await run(`1+1`, srv);
      times.push(r.wallMs);
      results.push(r.out && r.out.result);
    }
    await srv.close();
    const sorted = [...times].sort((a, b) => a - b);
    const withMcp = [];
    for (let i = 0; i < 4; i++) withMcp.push((await run(`1+1`)).out);
    return {
      oneTimeSetupMs: +srv.setupMs.toFixed(1),
      oneTimeSetupCovers: 'spawn dist/mcp-server.js (MCP integration off), MCP initialize, tools/list',
      firstExecutionMs: first.wallMs,
      medianMs: sorted[10],
      p90Ms: sorted[17],
      samples: times,
      results,
      withMcpIntegrationSameServerResults: withMcp.map((o) => (o && (o.success ? o.result : o.error && o.error.message))),
    };
  },
  async P12() {
    return {
      A_functionCtor: await fresh(`this.constructor.constructor("return typeof process")()`),
      B_sloppyThis: await fresh(`String((function(){ return this })().process)`),
      C_typeofs: await fresh(`[typeof process, typeof require, typeof std, typeof os, typeof fetch].join(",")`),
    };
  },
};

console.log('@@start ' + process.memoryUsage().rss);
const record = await (runtime === 'quickjs' ? qjsProbes : probes)[probe]();
const descriptionHead = executeTool?.description?.slice(0, 1500);
console.log(JSON.stringify({ runtime, probe, mode, setupMs: +setupMs.toFixed(1), executeToolDescription: descriptionHead, transportErrors: transportErrors.slice(0, 5), record }));
await client.close().catch(() => {});
process.exit(0);
