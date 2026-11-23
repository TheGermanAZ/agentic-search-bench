// Builds the code-mode implementation comparison from research/probes/results/*.json.
// Usage: bun run src/compare-impls.ts
// Writes research/code-mode-comparison.md, research/probes/matrix.html, research/probes/leaderboard.html and research/probes/gates.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./corpus";

// display is the short honest label for a cell (RUBRIC.md); outcome is the SPEC's outcome word.
type Probe = { outcome: string; detail?: string; evidence?: string; display?: string };
type Result = {
  impl: string;
  name: string;
  source: string;
  pinned: string;
  language: string;
  engine: string;
  how_run: string;
  probes: Record<string, Probe>;
  hardened?: { config: string; probes: Record<string, Probe> } | null;
  defaults?: Record<string, string>;
  source_notes?: { topic: string; finding: string; evidence: string }[];
  surprises?: string[];
};

const PROBES: [string, string][] = [
  ["P1", "Tool call"],
  ["P2", "Output"],
  ["P3", "Network"],
  ["P4", "Files"],
  ["P5", "Env secret"],
  ["P6", "Infinite loop"],
  ["P7", "Memory"],
  ["P8", "State"],
  ["P9", "Parallel calls"],
  ["P10", "Errors"],
  ["P11", "Startup"],
  ["P12", "Escape"],
];

// Closed services and patterns whose cells come from documentation, not from running anything.
const DOCS_ONLY = new Set(["anthropic-ptc", "anthropic-mcp-codeexec", "openai-ptc", "openai-code-interpreter", "cursor"]);
// Probed in part; the remaining cells are from docs.
const PARTLY_DOCS = new Set(["claude-code"]);

// Gate caveats that the outcome words cannot carry, each taken from the worker's evidence in the results file.
// "partial" means the probe was stopped, but not in the way the gate asks for.
type Gate = "pass" | "partial" | "fail";
const GATE_OVERRIDES: Record<string, { default?: Partial<Record<"G1" | "G2" | "G3", [Gate, string]>>; hardened?: Partial<Record<"G1" | "G2" | "G3", [Gate, string]>> }> = {
  "mcp-run-python": {
    default: { G3: ["partial", "MemoryError near the ~4 GiB wasm32 ceiling, no configured limit; 1 of 5 runs hit the 4 GiB harness kill first"] },
    hardened: { G3: ["partial", "same unconfigured wasm32 ceiling (2.9-3.6 GiB)"] },
  },
  // Downgrades from the independent shared-server checks (research/probes/verify/REPORT.md): the same limit failed under a variant.
  "bifrost-codemode": {
    default: { G3: ["fail", "verify: recursion is outside the memory budget; 12 concurrent scripts took the gateway past 4.1 GB"] },
    hardened: { G3: ["fail", "verify: same recursion path"] },
  },
  "tanstack-ai-codemode-node": {
    default: { G2: ["partial", "verify: the timeout never fires while the program awaits (still running at 110 s)"] },
    hardened: { G2: ["partial", "verify: same, the timeout covers synchronous code only"] },
  },
  "lattice-go-agent": { default: { G2: ["fail", "Execute returns at 20 s but the evaluation keeps running in the background"] } },
  "forgemax": { default: { G1: ["partial", "probes blocked, but guest stdout can forge IPC frames the host executes"] }, hardened: { G1: ["partial", "same IPC forging in the production config"] } },
  "ms-agent-framework-hyperlight": { default: { G1: ["pass", "ran only with hyperlight-sandbox 0.10.0, above the package's <0.10 pin"] } },
  "qwen-code-codemode": {
    default: { G1: ["fail", "code calls tools.read_file('/etc/hosts') with no approval"], G3: ["partial", "out of memory near 1.9 GB; the 64 MiB setting is not enforced"] },
    hardened: { G3: ["partial", "out of memory at 0.9 GB or more; the 64 MiB setting is not enforced"] },
  },
  "agno-codemode": { hardened: { G2: ["partial", "10 s interrupt, but a cell that catches BaseException keeps the kernel at 100% CPU"] } },
  "toolhive-vmcp-codemode": {
    default: { G2: ["partial", "step budget stops the literal loop; one builtin call on a 1 GB string ran past 120 s"], G3: ["fail", "no memory limit: a 35-step script reached 4.4 GB and the gateway died"] },
    hardened: { G2: ["partial", "step budget only; builtin calls cost one step"], G3: ["fail", "no memory limit; step budget only"] },
  },
};
// Caveats on gate-passing rows, from each results file's evidence. "host" caveats can stall or endanger the host
// process or other sessions, so they rank below every row without one.
const CAVEATS: Record<string, { severity: "host" | "minor"; text: string }> = {
  "tanstack-ai-codemode-quickjs-bun": { severity: "host", text: "guest runs as native QuickJS inside the host process (no WASM boundary); a runaway loop blocks the host event loop until the timeout" },
  "mastra-codemode-quickjs": { severity: "host", text: "a runaway loop blocked the host event loop for the whole timeout (0 of 50 timer ticks); host RSS stayed at 1.2-1.6 GB" },
  "mastra-codemode-isolated-vm": { severity: "host", text: "default 128 MB config: the host segfaulted after 1 of 10 memory bombs; hardened 32 MB held" },
  "ms-agent-framework-hyperlight": { severity: "minor", text: "ran only with hyperlight-sandbox 0.10.0, above the package's <0.10 pin; errors redacted by default; a ~50 KB print crashes the guest" },
  "vercel-ai-sdk-codemode": { severity: "minor", text: "independent check: every limit held, neighbors delayed at most ~0.3 s, host errors replaced by a generic message; console.log goes to host stdout, not the model; calls already sent keep running after a failure unless the tool honors the abort signal" },
  "vercel-run": { severity: "minor", text: "independent check: same results as AI SDK code mode; no tool discovery of its own; console.log goes to host stdout" },
  "fastmcp-codemode": { severity: "minor", text: "print() never reaches the model, only the return value; errors carry no line; independent check: host error text reaches the model unless mask_error_details=True (tested)" },
  "pydantic-ai-harness-codemode": { severity: "minor", text: "independent check: host tool error text reaches the model verbatim, so sanitize tool errors; printed output is capped at 10 MiB but forwarded with no truncation marker" },
  "pi-codemode": { severity: "minor", text: "package defaults are 300 s and no memory cap, so limits must be passed explicitly; independent check: no tool-call cap (2,000 concurrent calls ran) and host error text reaches the model" },
  "pydantic-monty": { severity: "minor", text: "library defaults set no limits; this is the engine under FastMCP and Pydantic AI Harness, which set them" },
  "langchain-quickjs": { severity: "minor", text: "independent check: the timeout overran 10-40x while the guest printed (51 s against 5 s), and a stack overflow raises a wasm Trap out of the agent turn; timeout counts VM time only" },
  "tanstack-ai-codemode-node": { severity: "host", text: "independent check: the timeout never fires while the program awaits, and a log flood took the server to 4.1 GB in 54 s; tool calls serial; host error text passes through" },
  "utcp-codemode": { severity: "host", text: "independent check: guest logs go into an unbounded host array, past 4 GB in 12.6 s with the 128 MB default and in 0.5 s with a 64 MB limit; host error text and HTTP bodies pass through; serial" },
  "bifrost-codemode": { severity: "host", text: "independent check: recursion is allowed and its stack is not charged to the memory budget; 12 concurrent recursive scripts passed 4.1 GB in under 0.8 s and took down the gateway, which also proxies the LLM calls; host error text passes through; serial" },
  "vercel-just-bash": { severity: "minor", text: "a bash interpreter over a virtual filesystem, not a JS tool bridge; loops stop on command and iteration counters (default deadline 60 min, hardened 30 s); serial" },
  "strands-codemode": { severity: "minor", text: "set timeout: defaults allow 60 s VM time and a 900 s wall clock; independent check: neighbors unaffected, in-flight calls cancelled, but host error text reaches the model with no masking option; every tool schema in the prompt" },
  "hermes-execute-code": { severity: "minor", text: "passes only with the Docker backend; independent check: tool_errors shows the model raw secrets, neighbors slowed to 11 s under load, limits overran by 1-8.6 s; only seven built-in tools callable; serial file RPC" },
  "openclaw-codemode-quickjs-wasi": { severity: "host", text: "independent check: a fixed pool of 4 workers, so 4 runaway programs delay others 10 s and 8 make them fail (cap concurrency yourself at 3); applies only with executor: \"quickjs\" (the default node:vm engine escapes); host errors only pattern-redacted" },
  "asb-quickjs": { severity: "minor", text: "this repo; reworked in this wave after the independent check (worker per execution, host wall clock, hidden bridge, streaming output cap, error scrub); serial bridge; 8 concurrent runaways fill the queue" },
};
// Order from the independent robustness checks (research/probes/verify/REPORT.md), which ran shared-server tests the
// SPEC does not: neighbor stalls, log floods, timeouts across awaits, error leakage. Unlisted rows follow by the rubric.
const VERIFIED_RANK = ["vercel-ai-sdk-codemode", "vercel-run", "pydantic-ai-harness-codemode", "fastmcp-codemode", "strands-codemode", "langchain-quickjs", "pi-codemode", "openclaw-codemode-quickjs-wasi", "hermes-execute-code"];
const vrank = (impl: string) => (VERIFIED_RANK.includes(impl) ? VERIFIED_RANK.indexOf(impl) : VERIFIED_RANK.length);
const PARTIAL_G2 = /blocks host|runs on|stays stuck|not after await|hangs host|caller freed|not stopped/;
const PARTIAL_G3 = /ceiling|timeout|\btime\b|loop count|caller hangs|segv|shared|ignored|wasm32|wasm heap|WASM cap|WASM ~/i;
const SAFE = /^(blocked|not-defined)/;
const NOT_RUN = /^(blocked-needs-credentials|not-applicable|not implemented|error \(setup crash\)|n\/a)/;

const dir = join(ROOT, "research", "probes", "results");
const SYNTH = join(ROOT, "research", "probes", "synthesis.md");
const isDocOnly = (r: Result) => DOCS_ONLY.has(r.impl);
const label = (p: Probe | undefined) => (!p ? "n/a" : (p.display ?? p.outcome));
const notRun = (r: Result) => !isDocOnly(r) && PROBES.every(([id]) => NOT_RUN.test(r.probes?.[id]?.outcome ?? "n/a") || NOT_RUN.test(label(r.probes?.[id])));
const merged = (r: Result): Record<string, Probe> => ({ ...r.probes, ...(r.hardened?.probes ?? {}) });

function gates(r: Result, probes: Record<string, Probe>, which: "default" | "hardened") {
  const o = (id: string) => probes[id]?.outcome ?? "n/a";
  const g: Record<"G1" | "G2" | "G3", [Gate, string]> = {
    G1: ["P3", "P4", "P5", "P12"].every((id) => SAFE.test(o(id)))
      ? ["pass", ""]
      : ["fail", ["P3", "P4", "P5", "P12"].filter((id) => !SAFE.test(o(id))).map((id) => `${id} ${label(probes[id])}`).join("; ")],
    G2: o("P6") !== "limited" ? ["fail", label(probes.P6)] : PARTIAL_G2.test(label(probes.P6)) ? ["partial", label(probes.P6)] : ["pass", label(probes.P6)],
    G3: o("P7") !== "limited" ? ["fail", label(probes.P7)] : PARTIAL_G3.test(label(probes.P7)) ? ["partial", label(probes.P7)] : ["pass", label(probes.P7)],
  };
  return { ...g, ...(GATE_OVERRIDES[r.impl]?.[which] ?? {}) };
}

const results = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return Array.isArray(r) ? (r as Result[]) : [r as Result];
  })
  .sort((a, b) => Number(isDocOnly(a) || notRun(a)) - Number(isDocOnly(b) || notRun(b)) || a.impl.localeCompare(b.impl));

const probed = results.filter((r) => !isDocOnly(r) && !notRun(r) && !PARTLY_DOCS.has(r.impl));
const gateRows = probed.map((r) => {
  const d = gates(r, r.probes, "default");
  const h = r.hardened ? gates(r, merged(r), "hardened") : null;
  const all = (g: typeof d | null) => !!g && g.G1[0] === "pass" && g.G2[0] === "pass" && g.G3[0] === "pass";
  return { r, d, h, eligible: all(d) ? "default" : all(h) ? "hardened" : null };
});

// Leaderboard: implementations that pass all three gates, ranked by RUBRIC.md's order for the measurable columns.
const parallel = (p?: Probe) => /^parallel/.test(label(p));
const capped = (p?: Probe) => /marker|truncated|capped/.test(label(p)) && !/no cap|no marker/.test(label(p));
const errLine = (p?: Probe) => /line/.test(label(p)) && !/no line/.test(label(p));
const startupMs = (p?: Probe) => {
  const m = `${label(p)} ${p?.detail ?? ""}`.match(/([\d.]+)\s*ms/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};
const board = gateRows
  .filter((g) => g.eligible)
  .map((g) => ({ ...g, probes: g.eligible === "hardened" ? merged(g.r) : g.r.probes }))
  .sort(
    (a, b) =>
      Number(CAVEATS[a.r.impl]?.severity === "host") - Number(CAVEATS[b.r.impl]?.severity === "host") ||
      vrank(a.r.impl) - vrank(b.r.impl) ||
      Number(parallel(b.probes.P9)) - Number(parallel(a.probes.P9)) ||
      Number(capped(b.probes.P2)) - Number(capped(a.probes.P2)) ||
      Number(errLine(b.probes.P10)) - Number(errLine(a.probes.P10)) ||
      Number(a.eligible === "hardened") - Number(b.eligible === "hardened") ||
      startupMs(a.probes.P11) - startupMs(b.probes.P11),
  );

const short = (s: string) => (s.split(/;| \(|, /)[0] ?? s).trim().slice(0, 60);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pipe = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const gcell = (g: [Gate, string] | undefined) => (!g ? "n/a" : g[0] === "pass" ? "pass" : `${g[0]}${g[1] ? ` (${g[1]})` : ""}`);
const tag = (r: Result) => (isDocOnly(r) ? " (docs-only)" : notRun(r) ? " (not run)" : PARTLY_DOCS.has(r.impl) ? " (partly docs)" : "");

let md = `# Code-mode implementations, compared hands-on\n\n${existsSync(SYNTH) ? `${readFileSync(SYNTH, "utf8")}\n` : ""}`;
md += `Every row comes from \`research/probes/results/<impl>.json\`. Probes are defined in \`research/probes/SPEC.md\`, gates and the hardened run in \`research/probes/RUBRIC.md\`. ${results.length} rows: ${probed.length} probed hands-on, ${results.filter(notRun).length} not run (need an account, unbuilt, or broken on setup), ${results.filter(isDocOnly).length} docs-only, ${PARTLY_DOCS.size} partly docs.\n\n`;
md += `## Leaderboard: passes all three gates\n\nG1 isolation, G2 a time limit of its own, G3 a per-execution memory limit that leaves the host alive, scored from the twelve probes and downgraded where research/probes/verify/REPORT.md showed the same limit failing another way (GATE_OVERRIDES in src/compare-impls.ts) or where a limit freezes the host while it waits. Rows with a caveat that can stall or endanger the host rank last. Rows that had the independent shared-server checks (research/probes/verify/REPORT.md) follow that ranking; the rest are ordered by parallel tool calls, then a capped output with a marker, then error line numbers, then default over hardened, then startup.\n\n| # | Implementation | Config | Engine | Parallel (P9) | Output (P2) | Errors (P10) | Startup (P11) | Caveat |\n|---|---|---|---|---|---|---|---|---|\n`;
board.forEach((b, i) => {
  md += `| ${i + 1} | ${b.r.name} | ${b.eligible} | ${pipe(short(b.r.engine))} | ${pipe(label(b.probes.P9))} | ${pipe(label(b.probes.P2))} | ${pipe(label(b.probes.P10))} | ${pipe(label(b.probes.P11))} | ${pipe(CAVEATS[b.r.impl] ? `${CAVEATS[b.r.impl]!.severity === "host" ? "HOST: " : ""}${CAVEATS[b.r.impl]!.text}` : "")} |\n`;
});
md += `\n## Gates for every probed implementation\n\n| Implementation | G1 default | G2 default | G3 default | G1 hardened | G2 hardened | G3 hardened |\n|---|---|---|---|---|---|---|\n`;
for (const g of gateRows) md += `| ${g.r.name} | ${pipe(gcell(g.d.G1))} | ${pipe(gcell(g.d.G2))} | ${pipe(gcell(g.d.G3))} | ${pipe(gcell(g.h?.G1))} | ${pipe(gcell(g.h?.G2))} | ${pipe(gcell(g.h?.G3))} |\n`;
md += `\n## Outcome matrix (default configuration)\n\n| Implementation | Engine | ${PROBES.map(([id, n]) => `${id} ${n}`).join(" | ")} |\n|---|---|${PROBES.map(() => "---").join("|")}|\n`;
for (const r of results) md += `| ${r.name}${tag(r)} | ${pipe(short(r.engine))} | ${PROBES.map(([id]) => pipe(label(r.probes?.[id]))).join(" | ")} |\n`;
md += "\n## Per implementation\n";
for (const r of results) {
  md += `\n### ${r.name}\n\n- Source: ${r.source} at \`${r.pinned}\`\n- Language and engine: ${r.language}, ${r.engine}\n- How it was run: ${r.how_run}\n`;
  if (r.defaults) md += `- Defaults: ${Object.entries(r.defaults).map(([k, v]) => `${k} ${v}`).join("; ")}\n`;
  if (r.hardened) md += `- Hardened config: ${pipe(r.hardened.config)}\n`;
  md += `\n| Probe | Outcome | Detail | Evidence |\n|---|---|---|---|\n`;
  for (const [id, n] of PROBES) {
    const p = r.probes?.[id];
    if (p) md += `| ${id} ${n} | ${pipe(label(p))} | ${pipe(p.detail ?? "")} | ${pipe(p.evidence ?? "")} |\n`;
  }
  if (r.hardened?.probes) {
    md += `\nHardened run:\n\n| Probe | Outcome | Detail | Evidence |\n|---|---|---|---|\n`;
    for (const [id, n] of PROBES) {
      const p = r.hardened.probes[id];
      if (p) md += `| ${id} ${n} | ${pipe(label(p))} | ${pipe(p.detail ?? "")} | ${pipe(p.evidence ?? "")} |\n`;
    }
  }
  if (r.source_notes?.length) md += `\nFrom the source:\n\n${r.source_notes.map((s) => `- **${s.topic}.** ${s.finding} (${s.evidence})`).join("\n")}\n`;
  if (r.surprises?.length) md += `\nSurprises:\n\n${r.surprises.map((s) => `- ${s}`).join("\n")}\n`;
}
writeFileSync(join(ROOT, "research", "code-mode-comparison.md"), md);

// Color follows what the outcome means for that probe: for network, files, env and escape, "works" is the risky result.
const SECURITY = new Set(["P3", "P4", "P5", "P12"]);
const LIMITS = new Set(["P6", "P7"]);
const cls = (o: string, id: string) => {
  if (/not-applicable|blocked-needs-credentials|^n\/a|not implemented|setup crash/.test(o)) return "na";
  if (/crash|^no cap|^no[- ]limit|^escaped|^host hang/.test(o)) return "risk";
  if (SECURITY.has(id)) return /^works/.test(o) ? "risk" : /^(blocked|not-defined)/.test(o) ? "ok" : "guard";
  if (LIMITS.has(id)) return /default/.test(o) ? "guard" : /^limited/.test(o) ? (PARTIAL_G3.test(o) || PARTIAL_G2.test(o) ? "guard" : "ok") : /^error/.test(o) ? "risk" : "guard";
  if (id === "P9") return /^parallel/.test(o) ? "ok" : "guard";
  if (id === "P8") return "guard";
  return /^works/.test(o) ? "ok" : /^error/.test(o) ? "risk" : "guard";
};
const gcls = (g?: [Gate, string]) => (!g ? "na" : g[0] === "pass" ? "ok" : g[0] === "partial" ? "guard" : "risk");
const rowHead = (r: Result) => `<th scope="row">${esc(r.name)}<span class="muted">${esc(tag(r).replace(/[()]/g, "").trim() ? `${tag(r).replace(/[()]/g, "").trim()} · ` : "")}${esc(short(r.engine))}</span></th>`;
const matrixTable = `<div class="tablewrap"><table class="matrix"><thead><tr><th>Implementation</th>${PROBES.map(([id, n]) => `<th title="${id}">${n}</th>`).join("")}</tr></thead><tbody>${results
  .map((r) => `<tr>${rowHead(r)}${PROBES.map(([id]) => {
    const p = r.probes?.[id];
    const o = label(p);
    return `<td class="${cls(o, id)}" title="${esc(p?.detail ?? "")}">${esc(o)}</td>`;
  }).join("")}</tr>`)
  .join("")}</tbody></table></div>`;
writeFileSync(join(ROOT, "research", "probes", "matrix.html"), matrixTable);

const gateTable = `<div class="tablewrap"><table class="matrix"><thead><tr><th>Implementation</th><th>G1 isolation</th><th>G2 time</th><th>G3 memory</th><th>G1 hardened</th><th>G2 hardened</th><th>G3 hardened</th></tr></thead><tbody>${gateRows
  .map((g) => `<tr>${rowHead(g.r)}${(["G1", "G2", "G3"] as const).map((k) => `<td class="${gcls(g.d[k])}" title="${esc(g.d[k][1])}">${g.d[k][0]}</td>`).join("")}${(["G1", "G2", "G3"] as const).map((k) => `<td class="${gcls(g.h?.[k])}" title="${esc(g.h?.[k]?.[1] ?? "no stricter option")}">${g.h ? g.h[k][0] : "n/a"}</td>`).join("")}</tr>`)
  .join("")}</tbody></table></div>`;
const boardTable = `<div class="tablewrap"><table class="matrix"><thead><tr><th>#</th><th>Implementation</th><th>Config</th><th>Parallel calls</th><th>Output</th><th>Errors</th><th>Startup</th><th>Caveat</th></tr></thead><tbody>${board
  .map((b, i) => `<tr><td>${i + 1}</td>${rowHead(b.r)}<td>${b.eligible}</td>${(["P9", "P2", "P10", "P11"] as const).map((id) => `<td class="${cls(label(b.probes[id]), id)}" title="${esc(b.probes[id]?.detail ?? "")}">${esc(label(b.probes[id]))}</td>`).join("")}</tr>`)
  .join("")}</tbody></table></div>`;
writeFileSync(join(ROOT, "research", "probes", "leaderboard.html"), boardTable);
writeFileSync(join(ROOT, "research", "probes", "gates.html"), gateTable);
writeFileSync(
  join(ROOT, "research", "probes", "gates.json"),
  `${JSON.stringify({ counts: { rows: results.length, probed: probed.length, notRun: results.filter(notRun).length, docsOnly: results.filter(isDocOnly).length, eligible: board.length }, board: board.map((b) => ({ impl: b.r.impl, config: b.eligible })), gates: gateRows.map((g) => ({ impl: g.r.impl, default: g.d, hardened: g.h })) }, null, 2)}\n`,
);
console.log(`compared ${results.length} rows (${probed.length} probed); ${board.length} pass all gates: ${board.map((b) => `${b.r.impl}${b.eligible === "hardened" ? "*" : ""}`).join(", ")}`);
