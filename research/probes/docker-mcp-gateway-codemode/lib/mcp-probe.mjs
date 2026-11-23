// Runs SPEC probes against a code-mode tool exposed over MCP.
// Usage: node mcp-probe.mjs <config.mjs> <outDir> <label-prefix> <probe ids...>
// The config module exports: probes {id: code | [code, code]}, connect() -> {client, tool, argName, extraArgs?},
// countFile, and optionally rss() -> MB, kill(), reset() (called after a probe that hit the 120 s cap or a crash).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [configPath, outDir, prefix, ...ids] = process.argv.slice(2);
const cfg = await import(pathToFileURL(resolve(configPath)).href);
mkdirSync(outDir, { recursive: true });

const CAP_MS = 120_000;
const RSS_CAP_MB = 4096;
const hostCalls = () => (existsSync(cfg.countFile) ? readFileSync(cfg.countFile, "utf8").split("\n").filter(Boolean).length : 0);
const textOf = (r) => (r?.content ?? []).map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");

let conn;
const setupStart = performance.now();
async function ensureConn() {
  if (!conn) conn = await cfg.connect();
  return conn;
}

async function exec(code, { watchRss = false, precise = false } = {}) {
  const { client, tool, argName, extraArgs = {} } = await ensureConn();
  const before = hostCalls();
  let peak = 0, killed = false, timer;
  const sampler = watchRss && cfg.rss ? setInterval(async () => {
    const mb = await cfg.rss().catch(() => 0);
    peak = Math.max(peak, mb);
    if (mb > RSS_CAP_MB && !killed) { killed = true; await cfg.kill?.(); }
  }, 250) : null;
  const startDate = new Date();
  const t0 = performance.now();
  let outcome;
  try {
    const call = client.callTool({ name: tool, arguments: { ...extraArgs, [argName]: code } }, undefined, { timeout: CAP_MS + 5000, maxTotalTimeout: CAP_MS + 5000 });
    const cap = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`harness cap ${CAP_MS} ms`)), CAP_MS); });
    const r = await Promise.race([call, cap]);
    outcome = { ok: true, isError: !!r.isError, text: textOf(r) };
  } catch (e) {
    outcome = { ok: false, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
    if (sampler) clearInterval(sampler);
  }
  const ms = precise ? Math.round((performance.now() - t0) * 100) / 100 : Math.round(performance.now() - t0);
  if (cfg.rss && watchRss) peak = Math.max(peak, await cfg.rss().catch(() => 0));
  const side = cfg.sideOutput ? await cfg.sideOutput(startDate).catch((e) => `sideOutput failed: ${e}`) : undefined;
  return { ms, hostCalls: hostCalls() - before, peakRssMB: watchRss ? peak : undefined, rssKilled: killed || undefined, side, ...outcome };
}

async function afterFailure(res) {
  if (!res.ok) {
    try { await conn?.client.close(); } catch {}
    conn = undefined;
    await cfg.reset?.();
  }
}

function save(id, codes, results, extra = {}) {
  const lines = [];
  codes.forEach((c, i) => {
    const r = results[i];
    lines.push(`--- code ${i + 1} ---\n${c}\n--- result ${i + 1} ---`);
    const { text, ...meta } = r;
    lines.push(JSON.stringify(meta));
    if (text !== undefined) lines.push(`text (${text.length} chars):\n${text.length > 4000 ? text.slice(0, 2000) + `\n...[harness elided ${text.length - 4000} chars when saving]...\n` + text.slice(-2000) : text}`);
  });
  if (Object.keys(extra).length) lines.push(`--- summary ---\n${JSON.stringify(extra)}`);
  writeFileSync(`${outDir}/${prefix}${id}.txt`, lines.join("\n") + "\n");
  const brief = results.map(({ text, ...m }) => ({ ...m, textLen: text?.length, textHead: text?.slice(0, 300) }));
  console.log(id, JSON.stringify({ ...extra, results: brief }));
}

for (const id of ids) {
  const code = cfg.probes[id];
  if (code === undefined) { console.log(id, "no code in config"); continue; }
  if (id === "P11") {
    await ensureConn(); const setupMs = Math.round(performance.now() - setupStart);
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(await exec(code, { precise: true }));
    }
    const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
    save(id, Array(20).fill(code), results, { medianMs: (sorted[9] + sorted[10]) / 2, p90Ms: sorted[17], setupMsConnectAndCreate: setupMs });
    continue;
  }
  const codes = Array.isArray(code) ? code : [code];
  const results = [];
  for (const c of codes) {
    const r = await exec(c, { watchRss: id === "P7" });
    results.push(r);
    await afterFailure(r);
  }
  save(id, codes, results);
}
try { await conn?.client.close(); } catch {}
process.exit(0);
