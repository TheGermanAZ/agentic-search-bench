import type { EvalQuestion } from "./build-evals";
import type { Judgments } from "./judge";
import type { RunResult, Strategy } from "./strategies";

export type Row = { qid: string; kind: EvalQuestion["kind"]; strategy: Strategy; model: string; trial: number; correct: boolean; result: RunResult };

export function isCorrect(q: EvalQuestion, r: RunResult, judged: Judgments = {}, answers: Judgments = {}): boolean {
  const a = r.answer.toLowerCase();
  switch (q.answerType) {
    case "count":
      return (a.match(/-?\d[\d,]*/)?.[0]?.replace(/,/g, "") ?? "") === q.answer;
    case "email":
      return a.includes(q.answer.toLowerCase());
    case "date":
      return a.includes(q.answer);
    case "message": {
      const cited = r.sources.some((s) => q.gold.includes(s) || judged[q.id]?.[s] === true);
      if (q.kind === "identifier") return cited && a.includes(q.answer.toLowerCase());
      return cited && answers[q.id]?.[r.answer] === true;
    }
  }
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export const groupOf = (r: Pick<Row, "qid" | "kind">) => (r.qid.startsWith("hrd-") ? "hard" : r.kind);

export function summarize(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    for (const key of [`${r.model}|${r.strategy}|${groupOf(r)}`, `${r.model}|${r.strategy}|all`]) groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups]
    .map(([key, rs]) => {
      const [model, strategy, kind] = key.split("|");
      const k = rs.filter((r) => r.correct).length;
      const [lo, hi] = wilson(k, rs.length);
      return {
        model,
        strategy,
        kind,
        n: rs.length,
        correct: k,
        accuracy: rs.length ? k / rs.length : 0,
        ci: [lo, hi] as [number, number],
        errors: rs.filter((r) => r.result.error).length,
        medianLatencyS: median(rs.map((r) => r.result.latencyMs / 1000)),
        medianToolCalls: median(rs.map((r) => r.result.toolCalls)),
        meanInputTokens: Math.round(mean(rs.map((r) => r.result.inputTokens))),
        meanToolResultChars: Math.round(mean(rs.map((r) => r.result.toolResultChars))),
        meanCostUsd: mean(rs.map((r) => r.result.costUsd)),
      };
    })
    .sort((a, b) => (a.model + a.kind + a.strategy).localeCompare(b.model + b.kind + b.strategy));
}

export function markdownTable(summary: ReturnType<typeof summarize>): string {
  const head = "| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |\n|---|---|---|---|---|---|---|---|---|---|";
  const lines = summary.map((s) => `| ${s.model} | ${s.kind} | ${s.strategy} | ${s.correct}/${s.n} (${pct(s.accuracy)}) | ${pct(s.ci[0])} to ${pct(s.ci[1])} | ${s.medianLatencyS.toFixed(1)}s | ${s.medianToolCalls} | ${s.meanInputTokens.toLocaleString("en-US")} | ${s.meanToolResultChars.toLocaleString("en-US")} | $${s.meanCostUsd.toFixed(3)} |`);
  return [head, ...lines].join("\n");
}
