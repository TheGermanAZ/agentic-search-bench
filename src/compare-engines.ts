// Builds the engine comparison from research/probes/engines/out/<engine>/summary.json (probe suite) and
// runs/engines-<engine>/results.jsonl (live benchmark questions).
// Usage: pnpm exec tsx src/compare-engines.ts   -> research/probes/engines/COMPARISON.md and research/probes/engines/table.html
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./corpus";
import { ENGINES } from "./engines";

type Rec = { id: string; ms: number; hostCalls: number; peakTreeMb: number; out: string };
type Row = { qid: string; correct: boolean; result: { latencyMs: number; toolCalls: number; costUsd: number; inputTokens: number; error?: string } };

const outDir = join(ROOT, "research", "probes", "engines", "out");
type Cell = { text: string; cls: "ok" | "guard" | "risk" | "na" };
const cell = (text: string, cls: Cell["cls"]): Cell => ({ text, cls });

function probeCells(recs: Map<string, Rec>): Record<string, Cell> {
  const o = (id: string) => recs.get(id)?.out ?? "";
  const has = (id: string) => recs.has(id);
  const blocked = (id: string, leak: RegExp) => (!has(id) ? cell("n/a", "na") : leak.test(o(id)) ? cell("reached host", "risk") : cell("blocked", "ok"));
  // The probe prints "<elapsed ms> 2,4,6,8,10"; FastMCP returns only the values, so fall back to host-measured time.
  const p9 = o("P9").match(/^(\d+) \d/m)?.[1];
  const p9ms = p9 ? Number(p9) : (recs.get("P9")?.ms ?? 0);
  const n = (id: string) => {
    const ms = Number(o(id).match(/in (\d+) ms/)?.[1] ?? Number.NaN);
    return Number.isNaN(ms) ? cell("n/a", "na") : cell(`${ms} ms`, ms < 500 ? "ok" : ms < 5000 ? "guard" : "risk");
  };
  const p6 = recs.get("P6");
  const p7 = recs.get("P7");
  return {
    tool: /\b42\b/.test(o("P1")) ? cell("works", "ok") : cell("failed", "risk"),
    output: /output truncated/.test(o("P2")) ? cell("capped + marker", "ok") : o("P2").length > 9000 ? cell("uncapped", "risk") : cell("no print returned", "guard"),
    net: blocked("P3", /\b200\b/),
    files: blocked("P4", /^\s*\d+\s*$/m),
    env: blocked("P5", /s3cr3t/),
    // JS: typeof process printed "object"/"function". Python: the subclass list printed, or os.system ran ("PWNED" or exit 0 on its own line).
    escape: /^(object|function|PWNED|0)$|^\[.*(_wrap_close|Popen).*\]$/m.test(`${o("P12a")}\n${o("P12b")}`) ? cell("reached host", "risk") : cell("blocked", "ok"),
    loop: !p6 ? cell("n/a", "na") : p6.ms < 120_000 && /ERROR|interrupt|imit|Timeout|stopped/i.test(p6.out) ? cell(`stopped ${(p6.ms / 1000).toFixed(0)} s`, "ok") : cell("not stopped", "risk"),
    memory: !p7 ? cell("n/a", "na") : /ERROR|memory|Memory|killed|stopped/i.test(p7.out) ? cell(`stopped, ${p7.peakTreeMb} MB peak`, p7.peakTreeMb < 1500 ? "ok" : "guard") : cell("not stopped", "risk"),
    state: /gone/.test(o("P8b")) ? cell("fresh", "ok") : cell("persists", "guard"),
    parallel: p9ms ? cell(`${p9ms} ms`, p9ms < 600 ? "ok" : "guard") : cell("n/a", "na"),
    errors: /line \d+|:\d+:\d+|line:? ?\d+/i.test(o("P10")) ? cell("message + line", "ok") : /probe-boom/.test(o("P10")) ? cell("message only", "guard") : cell("hidden", "risk"),
    hostErr: /postgres:\/\//.test(o("E1")) ? cell("leaked", "risk") : /<url>/.test(o("E1")) ? cell("scrubbed", "ok") : cell("masked", "guard"),
    startup: has("P11") ? cell(`${recs.get("P11")!.ms} ms`, recs.get("P11")!.ms < 20 ? "ok" : "guard") : cell("n/a", "na"),
    nLoop: n("N1"),
    nMem: n("N2"),
    nFlood: n("N3"),
  };
}

function liveCells(engine: string): { _n: number; [k: string]: Cell | number } {
  const p = join(ROOT, "runs", `engines-${engine}`, "results.jsonl");
  const rows: Row[] = existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row) : [];
  if (!rows.length) return { _n: 0, correct: cell("not run", "na"), latency: cell("", "na"), calls: cell("", "na"), cost: cell("", "na") };
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const right = rows.filter((r) => r.correct).length;
  return {
    _n: rows.length,
    correct: cell(`${right}/${rows.length}`, right === rows.length ? "ok" : right >= rows.length - 2 ? "guard" : "risk"),
    latency: cell(`${(med(rows.map((r) => r.result.latencyMs)) / 1000).toFixed(1)} s`, "guard"),
    calls: cell((rows.reduce((s, r) => s + r.result.toolCalls, 0) / rows.length).toFixed(1), "guard"),
    cost: cell(`$${rows.reduce((s, r) => s + r.result.costUsd, 0).toFixed(2)}`, "guard"),
  };
}

const COLS: [string, string][] = [
  ["tool", "Tool call"], ["output", "Output cap"], ["net", "Network"], ["files", "Files"], ["env", "Env secret"], ["escape", "Escape"],
  ["loop", "Busy loop"], ["memory", "Memory bomb"], ["state", "State"], ["parallel", "5 calls"], ["errors", "Errors"], ["hostErr", "Host error"],
  ["startup", "Per run"], ["nLoop", "Neighbor: loop"], ["nMem", "Neighbor: memory"], ["nFlood", "Neighbor: flood"],
];
const LIVE: [string, string][] = [["correct", "Live correct"], ["latency", "Median time"], ["calls", "Calls/question"], ["cost", "Cost"]];

const rows = Object.keys(ENGINES).flatMap((e) => {
  const f = join(outDir, e, "summary.json");
  if (!existsSync(f)) return [];
  const s = JSON.parse(readFileSync(f, "utf8")) as { description: string; results: Rec[] };
  return [{ e, desc: s.description, probes: probeCells(new Map(s.results.map((r) => [r.id, r]))), live: liveCells(e) }];
});

let md = "# Code-mode engines on this repo, compared\n\nEvery engine runs behind the same host contract (src/engines/host.ts): the six corpus functions, 60 s CPU, a 65 s wall clock, 512 MB per execution, an 8,000-char output cap, 8 concurrent executions. Probes: research/probes/engines/run.ts with a stand-in corpus. Neighbor columns time a normal request started 150 ms after a busy loop, a memory bomb or an output flood (about 250 ms means unaffected). Live: the same benchmark questions with exact answers, Claude Sonnet, code mode strategy.\n\n";
md += `| Engine | ${COLS.map((c) => c[1]).join(" | ")} | ${LIVE.map((c) => c[1]).join(" | ")} |\n|---|${[...COLS, ...LIVE].map(() => "---").join("|")}|\n`;
for (const r of rows) md += `| ${r.e} | ${COLS.map(([k]) => r.probes[k]!.text).join(" | ")} | ${LIVE.map(([k]) => (r.live as Record<string, Cell>)[k]!.text).join(" | ")} |\n`;
md += `\n## Engines\n\n${rows.map((r) => `- **${r.e}**: ${r.desc}`).join("\n")}\n`;
writeFileSync(join(ROOT, "research", "probes", "engines", "COMPARISON.md"), md);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<div class="tablewrap"><table class="matrix"><thead><tr><th>Engine</th>${[...COLS, ...LIVE].map((c) => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${rows
  .map((r) => `<tr><th scope="row">${esc(r.e)}<span class="muted">${esc(r.desc.split(/[;(]/)[0]!.slice(0, 70))}</span></th>${COLS.map(([k]) => `<td class="${r.probes[k]!.cls}">${esc(r.probes[k]!.text)}</td>`).join("")}${LIVE.map(([k]) => `<td class="${(r.live as Record<string, Cell>)[k]!.cls}">${esc((r.live as Record<string, Cell>)[k]!.text)}</td>`).join("")}</tr>`)
  .join("")}</tbody></table></div>`;
writeFileSync(join(ROOT, "research", "probes", "engines", "table.html"), html);
console.log(`compared ${rows.length} engines`);
