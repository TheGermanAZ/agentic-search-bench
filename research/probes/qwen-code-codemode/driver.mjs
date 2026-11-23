// Drives the released Qwen Code CLI (npm @qwen-code/qwen-code, pinned in research/impls/qwen-code-codemode/npm)
// headless, with tools.codeModeOnly on. A scripted OpenAI-compatible mock (no model) answers every model request:
// it returns one `exec` tool call per fixed source string, then reads the exec result back from the next request.
// So the code reaches Qwen Code's own exec tool through its own scheduler, exactly as a model's tool call would.
//
// Usage: node driver.mjs <config: default|hardened> <outName> <source1> [source2 ...]
//        node driver.mjs <config> P11 --repeat 20 "<source>"
// Env: DRIVER_PORT (default 42101), WATCH_RSS=1 to sample the CLI process tree RSS.
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "../../impls/qwen-code-codemode/npm/node_modules/@qwen-code/qwen-code/cli.js");
const PORT = Number(process.env.DRIVER_PORT ?? 42101);
const CAP_MS = 120_000;
const RSS_CAP_MB = 4096;

let [config, outName, ...rest] = process.argv.slice(2);
let sources = rest;
let repeat = 0;
if (rest.length === 0) {
  // Probe id mode: sources come from probes.mjs; the out file is "<prefix><id>.txt" (prefix "hardened-" for hardened).
  const { probes } = await import("./probes.mjs");
  const id = outName;
  const p = probes[id];
  if (!p) throw new Error(`no probe ${id}`);
  if (p.repeat) { repeat = p.repeat; sources = Array(repeat).fill(p.source); } else sources = Array.isArray(p) ? p : [p];
  outName = (config === "default" ? "" : `${config}-`) + id + (process.env.LOOKUP_READ_ONLY ? "-readonly" : "");
}
if (rest[0] === "--repeat") { repeat = Number(rest[1]); sources = Array(repeat).fill(rest[2]); }

const countFile = join(here, "out", "lookup-count.log");
const hostCalls = () => (existsSync(countFile) ? readFileSync(countFile, "utf8").split("\n").filter(Boolean).length : 0);

// Fresh QWEN_HOME per run, from the checked-in settings template for this config.
const home = join(here, "home", config);
const qwenHome = join(home, ".qwen");
rmSync(home, { recursive: true, force: true });
mkdirSync(qwenHome, { recursive: true });
const settings = JSON.parse(readFileSync(join(here, `settings.${config}.json`), "utf8"));
settings.mcpServers.probe.args = [join(here, "lookup-server.mjs"), "stdio"];
settings.mcpServers.probe.env = { LOOKUP_COUNT_FILE: countFile, ...(process.env.LOOKUP_READ_ONLY ? { LOOKUP_READ_ONLY: "1" } : {}) };
writeFileSync(join(qwenHome, "settings.json"), JSON.stringify(settings, null, 2));
const work = join(here, "work");
mkdirSync(work, { recursive: true });

// ---- scripted mock model ----
const events = [];
let idx = 0;
let execDescription;
const t0 = performance.now();
const now = () => Math.round((performance.now() - t0) * 100) / 100;

// The tool result for the latest exec call: the tool message after the last assistant message. Qwen Code
// sometimes appends a user message (a reminder) after it, so do not assume it is the final message.
function lastToolResult(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") return undefined;
    if (m.role === "tool") return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  }
  return undefined;
}

function reply(res, stream, message, finish) {
  const id = "mock-" + Math.random().toString(36).slice(2);
  if (!stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, object: "chat.completion", created: 0, model: "mock", choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const base = { id, object: "chat.completion.chunk", created: 0, model: "mock" };
  if (message.tool_calls) {
    send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: message.tool_calls.map((tc, i) => ({ index: i, ...tc })) }, finish_reason: null }] });
  } else {
    send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: message.content }, finish_reason: null }] });
  }
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let j = {};
  try { j = JSON.parse(body || "{}"); } catch {}
  if (!req.url.includes("chat/completions")) {
    events.push({ t: now(), kind: "other-request", method: req.method, url: req.url });
    res.writeHead(404).end();
    return;
  }
  const toolNames = (j.tools ?? []).map((t) => t.function?.name);
  const hasExec = toolNames.includes("exec");
  if (!hasExec) {
    events.push({ t: now(), kind: "side-request", tools: toolNames });
    reply(res, !!j.stream, { role: "assistant", content: "ok" }, "stop");
    return;
  }
  if (!execDescription) execDescription = { toolNames, exec: j.tools.find((t) => t.function?.name === "exec") };
  const prev = lastToolResult(j.messages ?? []);
  if (prev !== undefined) events.push({ t: now(), kind: "exec-result", n: idx, hostCallsSoFar: hostCalls(), text: prev });
  if (idx < sources.length) {
    const source = sources[idx++];
    events.push({ t: now(), kind: "exec-issued", n: idx, hostCallsSoFar: hostCalls() });
    reply(res, !!j.stream, { role: "assistant", content: null, tool_calls: [{ id: `call_${idx}`, type: "function", function: { name: "exec", arguments: JSON.stringify({ source }) } }] }, "tool_calls");
  } else {
    events.push({ t: now(), kind: "final" });
    reply(res, !!j.stream, { role: "assistant", content: "done" }, "stop");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ---- spawn the CLI ----
const env = {
  PATH: process.env.PATH,
  HOME: home,
  QWEN_HOME: qwenHome,
  TMPDIR: process.env.TMPDIR,
  OPENAI_API_KEY: "probe-local-dummy-not-a-credential",
  OPENAI_BASE_URL: `http://127.0.0.1:${PORT}/v1`,
  OPENAI_MODEL: "mock-model",
  QWEN_CODE_MODELS_DEV_REFRESH: "off",
  PROBE_SECRET: "s3cr3t",
  NO_COLOR: "1",
};
const extraArgs = JSON.parse(readFileSync(join(here, `args.${config}.json`), "utf8"));
const cliArgs = [CLI, "-p", "Run the scripted exec calls.", "--auth-type", "openai", "--model", "mock-model", "--output-format", "json", ...extraArgs];
const callsBefore = hostCalls();
const tSpawn = now();
const child = spawn(process.execPath, cliArgs, { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "";
child.stdout.on("data", (d) => { stdout += d; });
child.stderr.on("data", (d) => { if (stderr.length < 200_000) stderr += d; });

// RSS of the CLI's whole process tree (CLI + codeModeHost child + MCP server); only PIDs under our own child.
function tree() {
  const ps = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="]).toString().trim().split("\n").map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], rssKB: +m[3], cmd: m[4] };
  }).filter(Boolean);
  const out = [];
  const walk = (pid) => { for (const p of ps.filter((x) => x.ppid === pid)) { out.push(p); walk(p.pid); } };
  const self = ps.find((p) => p.pid === child.pid);
  if (self) out.push(self);
  walk(child.pid);
  return out;
}
let peak = { totalMB: 0, hostMB: 0 }, rssKilled = false, capped = false;
const killTree = () => { for (const p of tree().reverse()) { try { process.kill(p.pid, "SIGKILL"); } catch {} } };
const sampler = setInterval(() => {
  if (!process.env.WATCH_RSS) return;
  try {
    const t = tree();
    const total = t.reduce((s, p) => s + p.rssKB, 0) / 1024;
    const host = t.filter((p) => p.cmd.includes("codeModeHost")).reduce((s, p) => s + p.rssKB, 0) / 1024;
    peak.totalMB = Math.max(peak.totalMB, Math.round(total));
    peak.hostMB = Math.max(peak.hostMB, Math.round(host));
    if (total > RSS_CAP_MB && !rssKilled) { rssKilled = true; killTree(); }
  } catch {}
}, 100);
// NET_WATCH=1: record every remote endpoint the CLI tree has a socket to (evidence that only localhost/example.com are contacted).
const remotes = new Set();
const netSampler = process.env.NET_WATCH ? setInterval(() => {
  try {
    const pids = tree().map((p) => p.pid).join(",");
    if (!pids) return;
    const out = execFileSync("lsof", ["-a", "-i", "-n", "-P", "-p", pids], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    for (const l of out.split("\n").slice(1)) { const m = l.match(/->(\S+)/); if (m) remotes.add(m[1]); }
  } catch {}
}, 150) : null;
const cap = setTimeout(() => { capped = true; killTree(); }, CAP_MS);
const exit = await new Promise((r) => child.on("close", (code, sig) => r({ code, sig })));
clearTimeout(cap);
clearInterval(sampler);
if (netSampler) clearInterval(netSampler);
server.close();

// ---- report ----
const issued = events.filter((e) => e.kind === "exec-issued");
const results = events.filter((e) => e.kind === "exec-result");
const runs = issued.map((e, i) => {
  const r = results.find((x) => x.n === e.n);
  const markers = [];
  if (r?.text) { const re = /[^A-Za-z]{0,6}[^\n]{0,10}truncated[^\n]{0,40}/g; let m; while ((m = re.exec(r.text))) markers.push({ at: m.index, s: m[0] }); }
  const aCount = r?.text ? (r.text.match(/A/g) ?? []).length : undefined;
  return { n: e.n, ms: r ? Math.round((r.t - e.t) * 100) / 100 : undefined, hostCalls: r ? r.hostCallsSoFar - e.hostCallsSoFar : undefined, truncationMarkers: markers.length ? markers : undefined, countOfA: aCount, text: r?.text };
});
const summary = {
  config, exit, capped: capped || undefined, rssKilled: rssKilled || undefined,
  setupMsSpawnToFirstExec: issued[0] ? Math.round(issued[0].t - tSpawn) : undefined,
  totalHostCalls: hostCalls() - callsBefore,
  peakRssMB: process.env.WATCH_RSS ? peak : undefined,
  remoteEndpoints: process.env.NET_WATCH ? [...remotes] : undefined,
  sideRequests: events.filter((e) => e.kind === "side-request" || e.kind === "other-request").length,
};
if (repeat) {
  const ms = runs.map((r) => r.ms).filter((x) => x !== undefined).sort((a, b) => a - b);
  summary.p11 = { n: ms.length, medianMs: (ms[(ms.length >> 1) - 1] + ms[ms.length >> 1]) / 2, p90Ms: ms[Math.ceil(ms.length * 0.9) - 1], all: ms };
}
const lines = [];
lines.push(`# qwen-code-codemode ${outName} (${config})`);
sources.forEach((s, i) => {
  if (repeat && i > 0) return;
  const r = runs[i];
  lines.push(`--- exec ${i + 1} source ---\n${s}\n--- exec ${i + 1} result (${r?.ms} ms from tool call issued to tool result received; host lookup calls ${r?.hostCalls}) ---`);
  const t = r?.text;
  if (t === undefined) lines.push("(no exec result reached the model)");
  else lines.push(`text (${t.length} chars):\n${t.length > 6000 ? t.slice(0, 3000) + `\n...[harness elided ${t.length - 6000} chars when saving]...\n` + t.slice(-3000) : t}`);
});
lines.push(`--- summary ---\n${JSON.stringify(summary, null, 1)}`);
lines.push(`--- cli stdout (json, first 3000 chars) ---\n${stdout.slice(0, 3000)}`);
lines.push(`--- cli stderr (first 3000 chars) ---\n${stderr.slice(0, 3000)}`);
lines.push(`--- mock events ---\n${events.map(({ text, ...e }) => JSON.stringify({ ...e, textLen: text?.length })).join("\n")}`);
mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", `${outName}.txt`), lines.join("\n") + "\n");
if (execDescription) writeFileSync(join(here, "out", `exec-declaration.${config}.json`), JSON.stringify(execDescription, null, 2));
console.log(outName, JSON.stringify({ ...summary, runs: runs.map(({ text, ...r }) => ({ ...r, textLen: text?.length, textHead: text?.slice(0, 400) })) }));
process.exit(0);
