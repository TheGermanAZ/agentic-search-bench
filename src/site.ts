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

function overallTable(model: string, lat: boolean): string {
  const rows = STRATS.map((s) => {
    const all = get(summary, model, s.key, "all");
    const l = get(latencySummary, model, s.key, "all");
    if (!all) return "";
    return `<tr><th scope="row"><span class="sw" style="background:var(--s${s.slot})"></span>${s.name}</th><td>${all.correct}/${all.n} <span class="muted">(${pct(all.accuracy)})</span></td><td>${all.medianToolCalls}</td><td>${fmt(all.meanInputTokens)}</td><td>${fmt(all.meanToolResultChars)}</td><td>$${all.meanCostUsd.toFixed(3)}</td>${lat ? `<td>${l ? `${l.medianLatencyS.toFixed(1)}s` : "n/a"}</td>` : ""}</tr>`;
  }).join("");
  return `<div class="tablewrap"><table><thead><tr><th>Strategy</th><th>Correct</th><th>Median tool calls</th><th>Mean input tokens</th><th>Mean tool output chars</th><th>Mean cost</th>${lat ? "<th>Median latency, idle</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
    return `<article class="trace"><header><span class="sw" style="background:var(--s${s.slot})"></span><strong>${s.name}</strong><span class="verdict ${r.correct ? "ok" : "bad"}">${r.correct ? "Correct" : "Wrong"}</span></header><p class="meta">${calls.length} tool calls · ${fmt(r.result.inputTokens)} input tokens · answered <code>${esc(r.result.answer.slice(0, 60) || "nothing")}</code></p>${detail}</article>`;
  }).join("");
  return `<p class="q">“${esc(q.question)}” <span class="muted">Truth: <code>${esc(q.answer)}</code></span></p><div class="traces">${cells}</div>`;
}

const sonnet = MODELS.find((m) => m.includes("sonnet")) ?? MODELS[0];
const others = MODELS.filter((m) => m !== sonnet);
const nQ = new Set(main.filter((r) => r.model === sonnet).map((r) => r.qid)).size;
const hasLatency = latencyRows.length > 0;
const traceQ = arg("trace", "hrd-02");
const probeFile = (f: string) => (existsSync(join(ROOT, "research", "probes", f)) ? readFileSync(join(ROOT, "research", "probes", f), "utf8") : "");
const matrix = probeFile("matrix.html");
const leaderboard = probeFile("leaderboard.html");
const gatesTable = probeFile("gates.html");
const engineTable = probeFile("engines/table.html");
const counts = existsSync(join(ROOT, "research", "probes", "gates.json")) ? JSON.parse(probeFile("gates.json")).counts : { rows: 0, probed: 0, notRun: 0, docsOnly: 0, eligible: 0 };
const synthesisBullets = [
  "<strong>For TypeScript, Vercel AI SDK Code Mode (or Vercel Run, the engine under it).</strong> QuickJS in WebAssembly in a worker thread. With defaults it held every limit, ran tool calls in parallel, kept other users' requests within about 0.3 s while a neighbor misbehaved, and replaced host errors with a generic message. Programs must return their result: <code>console.log</code> goes to the server's stdout. Make tools honor the abort signal, because calls already sent keep running when a program fails.",
  "<strong>For Python, Pydantic AI Harness CodeMode, or FastMCP CodeMode for MCP servers.</strong> Both run Pydantic's Monty interpreter in a worker process with time and memory limits on by default and parallel tool calls. Mask host error text yourself (<code>mask_error_details=True</code> in FastMCP). Strands is close behind if you set its <code>timeout</code>; it cannot mask host errors.",
  "<strong>OpenCode and Claude Code's new Code Modes are safe at the language level but have no memory limit.</strong> OpenCode also allows <code>fetch</code> by default and its <code>execute</code> tool has no time limit; a memory bomb took its host process to 4.3 GB in a second.",
  "<strong>Isolation is the easy part; limits are where implementations fail.</strong> 30 of 69 let model code reach the host, mostly by running it with <code>exec</code>, IPython or a host-seeded <code>node:vm</code>. 33 had no working time limit and 40 no working memory limit with defaults: timers inside the guest that a loop never yields to, memory options accepted and ignored, and whole-process crashes that end every session.",
  "<strong>A shared server needs tests the usual probes skip.</strong> An independent reviewer found one user's loop freezing everyone (engines on the host's main thread), guest logs growing host memory past 4 GB (UTCP, TanStack Node), recursion outside the memory budget killing a gateway (Bifrost), and database URLs in tool errors reaching the model in most implementations.",
  "<strong>Tool discovery is keyword search or a searchable catalog, not embeddings.</strong> Pi and FastMCP use BM25; OpenClaw, Claude Code and Qwen Code let the program search a catalog; the Vercel AI SDK and langchain-quickjs can optionally defer tools to the provider's tool search, though by default they put every signature in the prompt. Cursor's current docs say its agent search is Instant Grep, a local regex index.",
  "<strong>The probes found five bugs in this repo's own sandbox, all fixed and re-tested.</strong> Shared asyncify state, an import that wedged later runs, a 512 MB memory cap that never applied (3.08 GB before the fix), one runaway program freezing every request for 60 s, and a bridge call that could make the host serialize the whole corpus. It now runs each program in its own worker thread with a host-side wall clock.",
  "<strong>Retention matters for case data.</strong> Anthropic's programmatic tool calling docs list zero data retention and HIPAA as not eligible, with data retained up to 30 days; OpenAI's docs say its version supports zero data retention.",
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
.card { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; display: grid; gap: 6px; }
</style>
<main>
<header style="display:grid;gap:12px">
  <span class="eyebrow">Benchmark · ${fmt(255154)} Enron emails · ${nQ} graded questions</span>
  <h1>Case File Search Bench</h1>
  <p class="lede">Four ways for an AI agent to search an investigation's evidence, measured on the same corpus and the same questions.</p>
  <p class="muted">German Alvarez · November 2026</p>
</header>

<section>
  <h2>The question I couldn't answer</h2>
  <blockquote>“Besides embedding and maybe full-text search, what search strategies are you familiar with? Let's say you have a corpus of 1 million documents and you need to find something.”</blockquote>
  <p>An interviewer asked me this recently, and I didn't have a good answer. This page is my answer, with measurements. I built the four strategies below, ran them against a real fraud-investigation corpus, and read how other agent harnesses solve the same problem.</p>
  <div class="answer"><p><strong>The short answer.</strong> Pick the strategy by the shape of the question, not by the corpus. Exact identifiers want a normalized exact index. Questions about who, when and how many want structured queries, ideally written by the agent as a program. Fuzzy "find the email where" questions want hybrid ranking. In this benchmark, agents that could combine search, grep and metadata queries answered 92 to 100% of questions; retrieval alone answered 34%.</p></div>
</section>

<section>
  <h2>Four strategies</h2>
  <div class="two">
    <div class="card"><h3><span class="sw" style="background:var(--s1)"></span>Hybrid RAG</h3><p class="muted">BM25 and embeddings fused with reciprocal rank fusion. The top 8 chunks go into one prompt. No tools.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s2)"></span>Agentic grep</h3><p class="muted">Claude Code's own Grep, Glob and Read over one text file per message. No index at all.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s3)"></span>Typed tools</h3><p class="muted">A corpus API as six tools: search, grep, messages, count, people, read.</p></div>
    <div class="card"><h3><span class="sw" style="background:var(--s4)"></span>Code mode</h3><p class="muted">The same six functions as a JavaScript object in a QuickJS sandbox behind one execute tool. Only what the program prints comes back to the model.</p></div>
  </div>
  <p class="muted">Typed tools and code mode expose the same six functions, and each call's output to the model is capped at 8,000 characters in both. A program can process thousands of records inside the sandbox and print only the result; a tool call has to hand its rows to the model. That is the difference being measured.</p>
</section>

<section>
  <h2>Results on ${modelName(sonnet)}</h2>
  <div class="legend">${STRATS.map((s) => `<span><span class="sw" style="background:var(--s${s.slot})"></span>${s.name}</span>`).join("")}</div>
  <div class="chart">${accuracyChart(sonnet)}</div>
  ${overallTable(sonnet, hasLatency)}
  ${groupTable(sonnet)}
</section>

${others.map((m) => `<section><h2>Same questions on ${modelName(m)}</h2><p>A smaller model shows whether the gaps hold when the model has less room for error.</p><div class="chart">${accuracyChart(m)}</div>${overallTable(m, false)}</section>`).join("")}

<section>
  <h2>What the numbers say</h2>
  <ul class="plain" id="findings">__FINDINGS__</ul>
</section>

<section>
  <h2>One question, four strategies</h2>
  ${trace(traceQ, sonnet)}
</section>

<section>
  <h2>${counts.rows} code-mode implementations, compared</h2>
  <p>A model decides what code to write; the sandbox decides what that code can do. So each sandbox can be tested on its own, with fixed code and no model in the loop. ${counts.probed} implementations ran on this machine against the same twelve probes, with their defaults and, where a project exposes stricter settings, with the strictest ones. ${counts.notRun} could not run here (hosted services that need an account, stubs, setup crashes) and ${counts.docsOnly} come only from documentation. An independent reviewer then reran the gate probes for 13 candidates and tested what a shared server needs: whether one user's runaway program delays another's. Every cell has evidence in the repo under <code>research/probes/</code>; hover a cell for the detail.</p>
  <ul class="plain">${synthesisBullets}</ul>
  <h3>Leaderboard: the ${counts.eligible} that pass all three gates</h3>
  <p class="muted">G1 isolation, G2 a time limit of their own, G3 a memory limit that leaves the host alive, from the twelve probes, downgraded where the independent check showed the same limit failing another way or where a limit freezes the host while it waits. Rows with a caveat that can stall or endanger the host rank last; rows that had the independent shared-server checks follow that ranking.</p>
  ${leaderboard}
  <h3>Gates for every probed implementation</h3>
  <div class="legend"><span><span class="sw" style="background:var(--okbg)"></span>pass</span><span><span class="sw" style="background:var(--guardbg)"></span>partial: stopped, but not the way the gate asks</span><span><span class="sw" style="background:var(--riskbg)"></span>fail</span></div>
  ${gatesTable}
  <details><summary>All twelve probes for all ${counts.rows} rows (default configuration)</summary>
  <div class="legend"><span><span class="sw" style="background:var(--okbg)"></span>safe, or works as intended</span><span><span class="sw" style="background:var(--guardbg)"></span>neutral design choice, or a limit with a caveat</span><span><span class="sw" style="background:var(--riskbg)"></span>risk: host access, escape, crash, or no limit</span><span><span class="sw" style="background:var(--rule)"></span>not applicable or not testable here</span></div>
  ${matrix}
  </details>
</section>

<section>
  <h2>Seven engines behind this repo's code mode</h2>
  <p>To act on the comparison, the code-mode strategy now takes any of seven sandboxes behind one interface (<code>src/engines/</code>), all held to the same contract: only the six corpus functions, 60 s of CPU, a 65 s wall clock, 512 MB per execution, an 8,000-character output cap, 8 at a time, scrubbed host errors. Each was probed with the same suite, timed while a neighbor program misbehaved, and run on 12 benchmark questions with exact answers on Claude Sonnet.</p>
  ${engineTable}
  <ul class="plain">
    <li><strong>All seven answered 12 of 12 and passed every safety probe.</strong> The engine changes how a program runs, not whether the model finds the answer.</li>
    <li><strong>Default is now Vercel Run.</strong> Parallel corpus calls (5 in 220 ms instead of 1,008 ms), 3.7 ms per execution, neighbors within 250 ms, pure WebAssembly with no native add-on, and the top rank in the independent shared-server checks. isolated-vm is faster (1 ms per execution, neighbors at 202 ms) and is the pick for CPU-heavy programs, but it is a native add-on that runs only on Node, and its V8 memory limit did not count WebAssembly memory until the engine removed <code>WebAssembly</code> from the guest.</li>
    <li><strong>For Python, Monty directly.</strong> py-monty matched the JavaScript engines: 4.7 ms per execution, parallel calls, errors with line numbers. FastMCP CodeMode drops printed output and, with error masking on, hides the program's own errors; the Pydantic AI Harness layer accepts only keyword arguments and its type checker rejects some valid code.</li>
    <li><strong>The comparison found a host bug that every engine shared.</strong> ripgrep ran synchronously, so one program that fired 31 greps at once froze the server for about 109 s, timers fired late, and a timeout killed a Python sidecar that other runs shared. grep is now asynchronous and shares identical scans; the same questions' slowest call fell from 109 s to 18 s.</li>
  </ul>
</section>

<section>
  <h2>What I would build for 20 to 30 million case files</h2>
  <ul class="plain">
    <li><strong>Ingest once into typed records.</strong> Every file gets a stable id, a content hash and page or row spans. Phone numbers, case numbers, plates and accounts get normalized into their own columns, so <span class="tag">773.555.0142</span> and <span class="tag">(773) 555-0142</span> are one value. Copies collapse by hash, as the 517,401 to 255,154 dedupe here did.</li>
    <li><strong>Index three ways.</strong> An exact identifier index, a full-text index, and a vector index with per-case filtering. Grep without an index gets slower as the corpus grows: here one pass over 1.2 GB took 3.5 to 4.7 seconds and agentic grep was the slowest strategy. At 20 million files I expect each pass to take minutes (an estimate, not measured).</li>
    <li><strong>Give the agent a typed API and let it write code against it in a sandbox.</strong> The program does the filtering, counting and joining. Only the result and its citations come back to the model. From the sandbox tests: run one isolate, worker or process per execution, enforce time and memory from outside the guest and test that they hold, keep credentials and case-access checks on the host side of the bridge, cap concurrency per user, sanitize host errors, and use an async bridge so one program can query several indexes at once. Off the shelf, that is Vercel Run (or AI SDK Code Mode on top of it) in TypeScript, and Pydantic's Monty interpreter in Python, used directly or through Pydantic AI Harness if you are on Pydantic AI.</li>
    <li><strong>Check citations outside the model.</strong> Re-read every cited span and recompute every number from the cited rows before an investigator sees it. My take-home for this kind of role did exactly that for evidence spreadsheets.</li>
    <li><strong>Grade it with exact ground truth.</strong> Counts and identifiers have one right answer, so most of an eval set can be graded by code, not by an LLM judge.</li>
  </ul>
</section>

<section>
  <h2>Method and limits</h2>
  <ul class="plain">
    <li>Corpus: the public Enron corpus from CMU. 517,401 files deduplicated to 255,154 messages by sender, date, subject and body, then split into 412,117 chunks of up to 1,200 characters, embedded locally with bge-small-en-v1.5.</li>
    <li>Questions: 15 aggregation and 10 identifier questions with truth from SQL, 15 paraphrased "find the email" questions written by an LLM from seed emails, and 10 hard questions with truth from ripgrep joined to metadata.</li>
    <li>"Find the email" is scored against the seed email plus every message any strategy cited that an LLM judge says states the answering fact. Seed replies often quote the original, and the original is an equally right citation. Every strategy is scored against the same pool.</li>
    <li>One trial per question and strategy. The intervals in the tables are Wilson intervals over these ${nQ} questions; they do not capture run-to-run variance, so small accuracy gaps are not meaningful. Token counts and tool calls are exact.</li>
    <li>Scoring. Counts, dates and addresses must match exactly. Identifier questions need both the right message cited and the right sender. "Find the email" questions need a relevant citation and an answer an LLM judge accepts. Citations are not checked on count and date questions. Two judges on different models agreed on 29 of 30 relevance calls.</li>
    <li>The hard tier was added after the first 40 questions saturated. It was designed to need counting over text matches, so treat it as an exploratory follow-up, not a held-out test.</li>
    <li>RAG here is one configuration: top 8 chunks, at most 4 chunks per message, one call. A RAG pipeline with a SQL step would answer counting questions; this measures retrieval-only RAG.</li>
    <li>After the runs, the sandbox probes and reviewers found five bugs in this repo's code-mode sandbox (see the comparison above). All are fixed and live questions still answer correctly, but the published code-mode runs used the original sandbox.</li>
    <li>After the runs, a review found that filtered keyword search filtered after taking the global top results, which could only have hurt typed tools and code mode. It is fixed in the code; the published runs used the old version.</li>
    <li>${hasLatency ? "Latency comes from a separate run on an idle machine, one question at a time." : "Latency is not reported here: the main runs shared one laptop with up to 10 concurrent agents."}</li>
    <li>Models run through the Claude Agent SDK with user settings, plugins and MCP configuration isolated. Costs are list-price estimates the SDK reports.</li>
  </ul>
</section>
</main>`;

mkdirSync(join(ROOT, "site"), { recursive: true });
writeFileSync(join(ROOT, "site", "index.html"), html.replace("__FINDINGS__", findings));
writeFileSync(join(ROOT, "site", "summary.json"), `${JSON.stringify({ summary, latencySummary }, null, 2)}\n`);
console.log(`wrote site/index.html (${MODELS.join(", ")}; ${main.length} rows; latency rows ${latencyRows.length})`);
