// Generates site/index.html from the benchmark results, so the write-up always matches the data.
// Usage: bun run src/site.ts [--run=main] [--latency=latency]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalQuestion } from "./build-evals";
import { ROOT } from "./corpus";
import { loadAnswerJudgments, loadJudgments } from "./judge";
import { type Row, groupOf, isCorrect, summarize } from "./score";

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const readRows = (run: string) => {
  const p = join(ROOT, "runs", run, "results.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row) : [];
};
const questions = new Map((JSON.parse(readFileSync(join(ROOT, "evals", "questions.json"), "utf8")) as EvalQuestion[]).map((q) => [q.id, q]));
const judged = loadJudgments();
const answers = loadAnswerJudgments();
const pooled = (rows: Row[]) => rows.map((r) => ({ ...r, correct: isCorrect(questions.get(r.qid) as EvalQuestion, r.result, judged, answers) }));
const main = pooled(readRows(arg("run", "main")));
const latencyRows = pooled(readRows(arg("latency", "latency")));
const summary = summarize(main);
const latencySummary = summarize(latencyRows);

const STRATS = [
  { key: "rag", name: "Hybrid RAG", slot: 1 },
  { key: "agentic", name: "Agentic grep", slot: 2 },
  { key: "tools", name: "Typed tools", slot: 3 },
  { key: "codemode", name: "Code mode", slot: 4 },
] as const;
const GROUPS = [
  { key: "aggregate", name: "Aggregation" },
  { key: "identifier", name: "Identifiers" },
  { key: "semantic", name: "Find the email" },
  { key: "hard", name: "Hard: text + counting, two-hop" },
] as const;
const MODELS = [...new Set(main.map((r) => r.model))].sort((a, b) => (a.includes("sonnet") ? -1 : b.includes("sonnet") ? 1 : 0));
const modelName = (m: string) => (m.includes("sonnet") ? "Sonnet 5.5" : m.includes("haiku") ? "Haiku 5.5" : m);
const get = (s: ReturnType<typeof summarize>, model: string, strategy: string, kind: string) => s.find((x) => x.model === model && x.strategy === strategy && x.kind === kind);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

function accuracyChart(model: string): string {
  const W = 720;
  const left = 150;
  const right = 56;
  const barH = 12;
  const gap = 2;
  const groupGap = 22;
  const plotW = W - left - right;
  let y = 28;
  const parts: string[] = [];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const x = left + t * plotW;
    parts.push(`<line x1="${x}" x2="${x}" y1="20" y2="__H__" class="grid"/><text x="${x}" y="14" class="tick" text-anchor="middle">${pct(t)}</text>`);
  }
  for (const g of GROUPS) {
    const top = y;
    for (const s of STRATS) {
      const r = get(summary, model, s.key, g.key);
      if (!r) continue;
      const w = Math.max(r.accuracy * plotW, 2);
      parts.push(`<g class="bar"><title>${esc(`${s.name}, ${g.name}: ${r.correct}/${r.n} (${pct(r.accuracy)}), 95% CI ${pct(r.ci[0])} to ${pct(r.ci[1])}`)}</title><rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3" fill="var(--s${s.slot})"/><text x="${left + w + 6}" y="${y + barH - 2}" class="val">${r.correct}/${r.n}</text></g>`);
      y += barH + gap;
    }
    parts.push(`<text x="${left - 10}" y="${(top + y) / 2 + 4}" class="glabel" text-anchor="end">${esc(g.name.split(":")[0])}</text>`);
    y += groupGap;
  }
  const H = y;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of questions answered correctly, by question type and strategy, ${modelName(model)}">${parts.join("").replaceAll("__H__", String(H - groupGap + 4))}</svg>`;
}

/** One horizontal bar per strategy, labeled directly, for a single measure. */
function strategyBars(values: { slot: number; name: string; value: number; label: string; tip: string }[], aria: string): string {
  const W = 360;
  const left = 104;
  const right = 72;
  const barH = 14;
  const step = 26;
  const max = Math.max(...values.map((v) => v.value));
  const plotW = W - left - right;
  const rows = values.map((v, i) => {
    const y = 8 + i * step;
    const w = Math.max((v.value / max) * plotW, 2);
    return `<g class="bar"><title>${esc(v.tip)}</title><text x="${left - 10}" y="${y + barH - 2}" class="glabel" text-anchor="end">${esc(v.name)}</text><rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3" fill="var(--s${v.slot})"/><text x="${left + w + 6}" y="${y + barH - 2}" class="val">${esc(v.label)}</text></g>`;
  });
  const H = 8 + values.length * step;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}"><line x1="${left}" x2="${left}" y1="2" y2="${H - 4}" class="grid"/>${rows.join("")}</svg>`;
}

function costFigures(model: string): string {
  const tokens = STRATS.flatMap((s) => {
    const r = get(summary, model, s.key, "all");
    return r ? [{ slot: s.slot, name: s.name, value: r.meanInputTokens, label: fmt(r.meanInputTokens), tip: `${s.name}: ${fmt(r.meanInputTokens)} input tokens per question on average, ${r.n} questions` }] : [];
  });
  const secs = STRATS.flatMap((s) => {
    const r = get(latencySummary, model, s.key, "all");
    return r ? [{ slot: s.slot, name: s.name, value: r.medianLatencyS, label: `${r.medianLatencyS.toFixed(1)} s`, tip: `${s.name}: median ${r.medianLatencyS.toFixed(1)} s per question, ${r.n} questions run one at a time` }] : [];
  });
  const fig = (title: string, svg: string, note: string) => `<figure class="chart small"><figcaption><strong>${title}</strong> <span class="muted">${note}</span></figcaption>${svg}</figure>`;
  return `<div class="two">${fig("Input tokens per question", strategyBars(tokens, `Mean input tokens per question by strategy, ${modelName(model)}`), `Mean over ${nQ} questions. Fewer tokens means lower cost.`)}${secs.length ? fig("Seconds per question", strategyBars(secs, `Median seconds per question by strategy, ${modelName(model)}`), `Median of ${latencyRows.filter((r) => r.model === model && r.strategy === "codemode").length} questions run one at a time. Rough.`) : ""}</div>`;
}

/** How retrieval-only RAG and code mode handle the same counting question (the trace below shows the real run). */
function mechanismFigure(): string {
  const box = (x: number, y: number, w: number, lines: string[], cls = "") =>
    `<g class="dbox ${cls}"><rect x="${x}" y="${y}" width="${w}" height="56" rx="6"/>${lines.map((l, i) => `<text x="${x + w / 2}" y="${y + 24 + i * 17 - (lines.length - 1) * 8}" text-anchor="middle">${esc(l)}</text>`).join("")}</g>`;
  const arrow = (x1: number, x2: number, y: number, label: string) =>
    `<line x1="${x1}" x2="${x2 - 4}" y1="${y}" y2="${y}" class="dedge" marker-end="url(#arr)"/><text x="${(x1 + x2) / 2}" y="${y - 8}" text-anchor="middle" class="dlabel">${esc(label)}</text>`;
  const row = (y: number, title: string, mid1: string[], mid2: string[], a1: string, a2: string, a3: string, answer: string[], ok: boolean, sandbox: boolean) =>
    `<text x="0" y="${y - 12}" class="dtitle">${esc(title)}</text>${box(0, y, 112, ["Counting", "question"])}${arrow(112, 196, y + 28, a1)}${box(196, y, 168, mid1, sandbox ? "" : "")}${arrow(364, 448, y + 28, a2)}${box(448, y, 168, mid2, sandbox ? "sandbox" : "")}${arrow(616, 702, y + 28, a3)}${box(702, y, 70, answer, ok ? "good" : "badbox")}`;
  return `<figure class="chart diagram"><svg viewBox="0 0 772 236" role="img" aria-label="Retrieval-only RAG shows the model 8 chunks and it answers 1, which is wrong. Code mode has the model write a program that scans every email in the sandbox and prints 46, which is right."><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>${row(34, "Hybrid RAG", ["Search index", "412,117 chunks"], ["Model reads", "8 chunks"], "sends", "top 8", "answers", ["1", "wrong"], false, false)}${row(160, "Code mode", ["Model writes", "one program"], ["Sandbox greps all", "255,154 emails"], "sends", "runs", "prints 46", ["46", "right"], true, true)}</svg><figcaption>Fig. 1. The answer counts 46 senders, so no 8 chunks can hold it. Code mode moves the counting into a program and returns only the number. Truth: 46.</figcaption></figure>`;
}

function overallTable(model: string, lat: boolean): string {
  const rows = STRATS.map((s) => {
    const all = get(summary, model, s.key, "all");
    const l = get(latencySummary, model, s.key, "all");
    if (!all) return "";
    return `<tr><th scope="row"><span class="sw" style="background:var(--s${s.slot})"></span>${s.name}</th><td>${all.correct}/${all.n} <span class="muted">(${pct(all.accuracy)})</span></td><td>${all.medianToolCalls}</td><td>${fmt(all.meanInputTokens)}</td><td>${fmt(all.meanToolResultChars)}</td><td>$${all.meanCostUsd.toFixed(3)}</td>${lat ? `<td>${l ? `${l.medianLatencyS.toFixed(1)}s` : "n/a"}</td>` : ""}</tr>`;
  }).join("");
  return `<div class="tablewrap"><table><thead><tr><th>Strategy</th><th>Correct</th><th>Median tool calls</th><th>Mean input tokens</th><th>Mean tool output chars</th><th>Mean cost</th>${lat ? "<th>Median latency, one at a time</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function groupTable(model: string): string {
  const head = `<tr><th>Question type</th>${STRATS.map((s) => `<th>${s.name}</th>`).join("")}</tr>`;
  const body = GROUPS.map((g) => `<tr><th scope="row">${g.name}</th>${STRATS.map((s) => {
    const r = get(summary, model, s.key, g.key);
    return `<td>${r ? `${r.correct}/${r.n} <span class="muted">· ${fmt(r.meanInputTokens)} tok</span>` : "n/a"}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table class="compact"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function trace(qid: string, model: string): string {
  const q = questions.get(qid);
  if (!q) return "";
  const cells = STRATS.map((s) => {
    const r = main.find((x) => x.qid === qid && x.model === model && x.strategy === s.key);
    if (!r) return "";
    const calls = r.result.trace;
    let detail = "";
    if (s.key === "codemode" && calls[0]) {
      const code = (JSON.parse(calls[0].input) as { code: string }).code;
      detail = `<pre><code>${esc(code)}</code></pre>`;
    } else if (calls.length) {
      detail = `<ol class="calls">${calls.slice(0, 8).map((c) => `<li><code>${esc(c.tool.replace("mcp__corpus__", ""))}</code> <span class="muted">${esc(c.input.slice(0, 110))}${c.input.length > 110 ? "…" : ""}</span></li>`).join("")}${calls.length > 8 ? `<li class="muted">and ${calls.length - 8} more</li>` : ""}</ol>`;
    } else {
      detail = `<p class="muted">No tools. One prompt with the top 8 retrieved chunks.</p>`;
    }
    return `<article class="trace"><header><span class="sw" style="background:var(--s${s.slot})"></span><strong>${s.name}</strong><span class="verdict ${r.correct ? "ok" : "bad"}">${r.correct ? "Correct" : "Wrong"}</span></header><p class="meta">${calls.length} tool call${calls.length === 1 ? "" : "s"} · ${fmt(r.result.inputTokens)} input tokens · answered <code>${esc(r.result.answer.slice(0, 60) || "nothing")}</code></p>${detail}</article>`;
  }).join("");
  return `<p class="q">“${esc(q.question)}” <span class="muted">Truth: <code>${esc(q.answer)}</code></span></p><div class="traces">${cells}</div>`;
}

const sonnet = MODELS.find((m) => m.includes("sonnet")) ?? MODELS[0];
const others = MODELS.filter((m) => m !== sonnet);
const nQ = new Set(main.filter((r) => r.model === sonnet).map((r) => r.qid)).size;
const hasLatency = latencyRows.length > 0;
const traceQ = arg("trace", "hrd-02");
const probeFile = (f: string) => (existsSync(join(ROOT, "research", "probes", f)) ? readFileSync(join(ROOT, "research", "probes", f), "utf8") : "");
const leaderboard = probeFile("leaderboard.html");
const gatesTable = probeFile("gates.html");
const engineTable = probeFile("engines/table.html");
const counts = existsSync(join(ROOT, "research", "probes", "gates.json")) ? JSON.parse(probeFile("gates.json")).counts : { rows: 0, probed: 0, notRun: 0, docsOnly: 0, eligible: 0 };
const synthesisBullets = [
  "<strong>For TypeScript, Vercel AI SDK Code Mode (Vercel Run underneath).</strong> QuickJS in WebAssembly in a worker thread. With defaults it held every limit, ran tool calls in parallel and kept host error text away from the model.",
  "<strong>For Python, Pydantic AI Harness CodeMode, or FastMCP CodeMode for MCP servers.</strong> Both run Pydantic's Monty interpreter with time and memory limits on by default. In this repo, Monty used directly did better than either wrapper.",
  "<strong>Most implementations isolate code. Far fewer enforce limits.</strong> 30 of 69 let model code reach the host, 33 had no working time limit and 40 no working memory limit with defaults. OpenCode and Claude Code's Code Modes have no memory limit; a memory bomb took OpenCode's host process to 4.3 GB in a second.",
  "<strong>The probes found five bugs in this repo's own sandbox, all fixed and re-tested.</strong> The worst was a 512 MB memory cap that never applied (3.08 GB before the fix).",
].map((b) => `<li>${b}</li>`).join("");
const findingsPath = join(ROOT, "notes", "findings.html");
const findings = existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : "<li>Findings pending.</li>";

const html = `<title>Case File Search Bench</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap">
<style>
/* Layout: one reading column; tables and charts may scroll sideways inside their own boxes. */
:root {
  --bg: #f7f8fa; --panel: #ffffff; --fg: #14171c; --fg2: #4a5160; --muted: #6b7280; --rule: #dfe3ea; --accent: #2541b2; --tag: #8a5a00; --tagbg: #fff4dc;
  --ok: #0f7a3a; --bad: #b42318; --okbg: #e3f3e8; --guardbg: #e6ecfa; --riskbg: #fbe1dd;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --display: "Space Grotesk", "Helvetica Neue", Arial, sans-serif; --body: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #121418; --panel: #1a1d23; --fg: #eceef2; --fg2: #b9bfcb; --muted: #8b93a3; --rule: #2c313b; --accent: #8ea2ff; --tag: #ffcf7a; --tagbg: #3a2c10;
  --ok: #4ccb7f; --bad: #ff8a80; --okbg: #17331f; --guardbg: #1c2540; --riskbg: #45201b; --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #121418; --panel: #1a1d23; --fg: #eceef2; --fg2: #b9bfcb; --muted: #8b93a3; --rule: #2c313b; --accent: #8ea2ff; --tag: #ffcf7a; --tagbg: #3a2c10;
  --ok: #4ccb7f; --bad: #ff8a80; --okbg: #17331f; --guardbg: #1c2540; --riskbg: #45201b; --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font: 16px/1.6 var(--body); }
main { max-width: 860px; margin: 0 auto; padding-block: 40px 80px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 40px; }
section { display: grid; gap: 14px; min-width: 0; }
h1, h2, h3 { font-family: var(--display); line-height: 1.15; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(30px, 5vw, 44px); letter-spacing: -0.01em; }
h2 { font-size: 24px; }
h3 { font-size: 17px; }
p { margin: 0; max-width: 68ch; color: var(--fg); }
.lede { font-size: 18px; color: var(--fg2); }
.eyebrow { font: 500 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.muted { color: var(--muted); }
code, pre { font-family: var(--mono); font-size: 13px; }
a { color: var(--accent); }
blockquote { margin: 0; padding: 14px 18px; border-left: 3px solid var(--accent); background: var(--panel); color: var(--fg2); max-width: 68ch; }
.answer { padding: 18px 20px; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; }
.tablewrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: 8px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th { font: 500 12px/1.3 var(--body); color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
tbody tr:last-child > * { border-bottom: 0; }
table.compact td { white-space: nowrap; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 8px; vertical-align: 0; }
.chart { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 16px; overflow-x: auto; }
.chart svg { width: 100%; min-width: 520px; height: auto; display: block; }
.grid { stroke: var(--rule); stroke-width: 1; }
.tick { fill: var(--muted); font: 11px var(--mono); }
.glabel { fill: var(--fg2); font: 500 13px var(--body); }
.val { fill: var(--fg2); font: 11px var(--mono); }
.bar:hover rect { opacity: 0.8; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--fg2); }
.traces { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 12px; }
.trace { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px; display: grid; gap: 8px; min-width: 0; align-content: start; }
.trace header { display: flex; align-items: center; gap: 4px; }
.verdict { margin-left: auto; font: 500 12px var(--mono); padding: 2px 8px; border-radius: 999px; }
.verdict.ok { color: var(--ok); border: 1px solid var(--ok); }
.verdict.bad { color: var(--bad); border: 1px solid var(--bad); }
.meta { font-size: 13px; color: var(--fg2); }
.trace pre { margin: 0; padding: 10px; background: var(--bg); border-radius: 6px; overflow-x: auto; max-height: 340px; }
.calls { margin: 0; padding-left: 20px; font-size: 13px; display: grid; gap: 4px; }
.calls li { overflow-wrap: anywhere; }
.q { font-size: 15px; }
.tag { font: 500 12px var(--mono); color: var(--tag); background: var(--tagbg); padding: 1px 6px; border-radius: 4px; }
ul.plain { margin: 0; padding-left: 20px; display: grid; gap: 6px; max-width: 68ch; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.matrix { font-size: 12px; }
.matrix th[scope="row"] { min-width: 190px; font-weight: 600; }
.matrix th[scope="row"] .muted { display: block; font-weight: 400; font-size: 11px; }
.matrix td { white-space: nowrap; font-family: var(--mono); font-size: 11px; }
.matrix td.ok { background: var(--okbg); }
.matrix td.guard { background: var(--guardbg); }
.matrix td.risk { background: var(--riskbg); font-weight: 500; }
.matrix td.na { color: var(--muted); }
details { display: grid; gap: 10px; }
summary { cursor: pointer; color: var(--accent); font-weight: 500; }
.matrix td.guard[style] { font-family: var(--body); }
.verify { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; font-size: 14px; }
.verify summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--fg2); }
.chip { font: 500 12px var(--mono); padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.chip.ok { color: var(--ok); }
.chip.fix { color: var(--tag); }
.chip.na { color: var(--muted); }
figure { margin: 0; min-width: 0; }
figcaption { font-size: 14px; color: var(--fg2); max-width: 68ch; }
.chart.small { display: grid; gap: 10px; }
.chart.small svg { min-width: 0; }
.diagram { display: grid; gap: 12px; color: var(--fg2); }
.diagram svg { min-width: 640px; }
.dbox rect { fill: var(--bg); stroke: var(--rule); stroke-width: 1.5; }
.dbox text { fill: var(--fg); font: 500 13px var(--body); }
.dbox.sandbox rect { stroke: var(--s4); stroke-width: 2; }
.dbox.good rect { stroke: var(--ok); stroke-width: 2; }
.dbox.good text { fill: var(--ok); }
.dbox.badbox rect { stroke: var(--bad); stroke-width: 2; stroke-dasharray: 5 4; }
.dbox.badbox text { fill: var(--bad); }
.dedge { stroke: currentColor; stroke-width: 1.5; }
.dlabel { fill: var(--fg2); font: 12px var(--mono); }
.dtitle { fill: var(--fg); font: 600 13px var(--display); }
.card { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; display: grid; gap: 6px; }
</style>
<main>
<details class="verify"><summary><span class="eyebrow">Fact-checked against the repo, 23 Nov 2026</span></summary>
  <p class="muted">Every accuracy, token, call and latency figure was recomputed from <code>runs/</code>, the survey counts from <code>research/probes/</code> and the engine figures from the engine probes. Five errors in an earlier version were fixed.</p>
</details>
<header style="display:grid;gap:12px">
  <span class="eyebrow">Benchmark · ${fmt(255154)} Enron emails · ${nQ} graded questions</span>
  <h1>Case File Search Bench</h1>
  <p class="lede">Four ways for an AI agent to search an investigation's evidence, measured on the same corpus and the same questions.</p>
  <p class="muted">German Alvarez · November 2026</p>
</header>

<section>
  <h2>The question I couldn't answer</h2>
  <blockquote>“Besides embedding and maybe full-text search, what search strategies are you familiar with? Let's say you have a corpus of 1 million documents and you need to find something.”</blockquote>
  <p>An interviewer asked me this recently, and I didn't have a good answer. This page answers it with measurements from four strategies run on a real fraud-investigation corpus.</p>
  <div class="answer"><p><strong>The short answer.</strong> Pick the strategy by the shape of the question. Exact identifiers want an exact index, counting questions want a program the agent writes, and fuzzy "find the email" questions want hybrid ranking. Agents that combined search, grep and metadata answered 92 to 100% of questions; retrieval alone answered 34%.</p></div>
</section>

<section>
  <h2>Four ways to search the same case file</h2>
  <div class="two">
    <div class="card"><h3><span class="sw" style="background:var(--s1)"></span>Hybrid RAG</h3><p class="muted">BM25 and embeddings fused with reciprocal rank fusion. The top 8 chunks go into one prompt. No tools.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s2)"></span>Agentic grep</h3><p class="muted">Claude Code's own Grep, Glob and Read over one text file per message. No index at all.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s3)"></span>Typed tools</h3><p class="muted">A corpus API as six tools: search, grep, messages, count, people, read.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s4)"></span>Code mode</h3><p class="muted">The same six functions in a sandbox behind one execute tool. Only what the program prints comes back to the model.</p></div>
  </div>
  <p class="muted">Typed tools and code mode expose the same functions, with output capped at 8,000 characters. A program can process thousands of records in the sandbox and print only the result. A tool call has to hand its rows to the model.</p>
  ${mechanismFigure()}
</section>

<section>
  <h2>Results on ${modelName(sonnet)}</h2>
  <div class="legend">${STRATS.map((s) => `<span><span class="sw" style="background:var(--s${s.slot})"></span>${s.name}</span>`).join("")}</div>
  <div class="chart">${accuracyChart(sonnet)}</div>
  ${costFigures(sonnet)}
  ${overallTable(sonnet, hasLatency)}
  ${groupTable(sonnet)}
</section>

${others.map((m) => `<section><h2>Same questions on ${modelName(m)}</h2><p>A smaller model, to check whether the gaps hold.</p><div class="chart">${accuracyChart(m)}</div></section>`).join("")}

<section>
  <h2>Retrieval alone cannot count; code mode counts cheapest</h2>
  <ul class="plain" id="findings">__FINDINGS__</ul>
</section>

<section>
  <h2>One question, four strategies</h2>
  ${trace(traceQ, sonnet)}
</section>

<section>
  <h2>${counts.rows} code-mode implementations, compared</h2>
  <p>A model decides what code to write; the sandbox decides what that code can do. So I tested each sandbox with fixed code and no model. ${counts.probed} implementations ran here against twelve probes, with defaults and with the strictest settings each exposes. ${counts.notRun} could not run here and ${counts.docsOnly} come only from documentation. The evidence for every cell is in the repo under <code>research/probes/</code>.</p>
  <ul class="plain">${synthesisBullets}</ul>
  <h3>The ${counts.eligible} that pass all three gates</h3>
  <p class="muted">G1 isolation, G2 a time limit of its own, G3 a memory limit that leaves the host alive. Rows with a caveat that can stall the host rank last.</p>
  ${leaderboard}
  <details><summary>Gates for all ${counts.probed} probed implementations</summary>
  <div class="legend"><span><span class="sw" style="background:var(--okbg)"></span>pass</span><span><span class="sw" style="background:var(--guardbg)"></span>partial: stopped, but not the way the gate asks</span><span><span class="sw" style="background:var(--riskbg)"></span>fail</span></div>
  ${gatesTable}
  </details>
  <p class="muted">The full twelve-probe matrix for all ${counts.rows} rows is in the repo at <code>research/probes/matrix.html</code>.</p>
</section>

<section>
  <h2>Seven sandbox engines, one contract, same answers</h2>
  <p>The code-mode strategy now takes any of seven sandboxes behind one interface (<code>src/engines/</code>), each held to the same limits: 60 s of CPU, 512 MB per execution, an 8,000-character output cap and scrubbed host errors.</p>
  ${engineTable}
  <ul class="plain">
    <li><strong>All seven answered 12 of 12 questions on Sonnet and passed every safety probe.</strong> The engine changes how a program runs, not whether the model finds the answer.</li>
    <li><strong>The default is Vercel Run.</strong> It takes 3.7 ms per execution, runs 5 corpus calls in 220 ms instead of 1,008 ms, and needs no native add-on. isolated-vm is faster (1 ms) for CPU-heavy programs but runs only on Node. For Python, py-monty kept pace at 4.7 ms.</li>
    <li><strong>The comparison found a host bug every engine shared.</strong> Synchronous ripgrep let one program freeze the server for about 109 s. grep is now asynchronous, and the slowest call fell to 18 s.</li>
  </ul>
</section>

<section>
  <h2>What I would build for 20 to 30 million case files</h2>
  <ul class="plain">
    <li><strong>Ingest once into typed records.</strong> Stable ids, content hashes, and identifiers normalized into their own columns, so <span class="tag">773.555.0142</span> and <span class="tag">(773) 555-0142</span> are one value.</li>
    <li><strong>Index three ways.</strong> Exact identifiers, full text, and vectors filtered per case. One unindexed grep pass over 1.2 GB took 3.5 to 4.7 seconds here; at 20 million files I expect minutes (an estimate, not measured).</li>
    <li><strong>Let the agent write code against a typed API in a sandbox.</strong> The program filters, counts and joins, and only the result and its citations reach the model. Enforce time and memory from outside the guest, and keep case-access checks on the host.</li>
    <li><strong>Check citations outside the model.</strong> Re-read every cited span and recompute every number before an investigator sees it. Counts and identifiers have one right answer, so code can grade most of the eval set.</li>
  </ul>
</section>

<section>
  <h2>Method and limits</h2>
  <ul class="plain">
    <li>The corpus is the public Enron corpus from CMU. 517,401 files were deduplicated to 255,154 messages, split into 412,117 chunks and embedded locally with bge-small-en-v1.5.</li>
    <li>There are 15 aggregation and 10 identifier questions with truth from SQL, 15 "find the email" questions, and 10 hard questions with truth from ripgrep joined to metadata. The hard tier was added after the first 40 saturated, so treat it as exploratory.</li>
    <li>Counts, dates and identifiers must match exactly. "Find the email" answers need a relevant citation and an LLM judge's approval; two judges on different models agreed on 29 of 30 relevance calls.</li>
    <li>One trial per question and strategy, so small accuracy gaps are not meaningful. Token counts and tool calls are exact.${hasLatency ? " Latency comes from a separate run of 8 questions on Sonnet, one at a time." : ""}</li>
    <li>RAG here is retrieval only: top 8 chunks, one call. A RAG pipeline with a SQL step would answer counting questions.</li>
    <li>The published runs used Bun and the original sandbox, before the sandbox fixes, the Node 24 port, asynchronous grep and a fix to filtered keyword search that could only have hurt typed tools and code mode. The engine reruns used the new setup.</li>
  </ul>
</section>
</main>`;

mkdirSync(join(ROOT, "site"), { recursive: true });
writeFileSync(join(ROOT, "site", "index.html"), html.replace("__FINDINGS__", findings));
writeFileSync(join(ROOT, "site", "summary.json"), `${JSON.stringify({ summary, latencySummary }, null, 2)}\n`);
console.log(`wrote site/index.html (${MODELS.join(", ")}; ${main.length} rows; latency rows ${latencyRows.length})`);
