// Usage: bun run src/bench.ts --run=<name> [--model=claude-sonnet-5-5] [--strategies=rag,agentic,codemode] [--only=agg-01,sem-30] [--trials=1] [--concurrency=4]
// Results append to runs/<name>/results.jsonl; rerunning the same command skips finished (question, strategy, model, trial) cells.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalQuestion } from "./build-evals";
import { ROOT, openDb } from "./corpus";
import { type Row, isCorrect, markdownTable, summarize } from "./score";
import { Corpus } from "./search";
import { STRATEGIES, type Strategy, runStrategy } from "./strategies";

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const runName = arg("run", "dev");
const model = arg("model", "claude-sonnet-5-5");
if (arg("engine", "")) process.env.CODEMODE_ENGINE = arg("engine", "");
const strategies = arg("strategies", STRATEGIES.join(",")).split(",") as Strategy[];
const only = arg("only", "").split(",").filter(Boolean);
const trials = Number(arg("trials", "1"));
const concurrency = Number(arg("concurrency", "4"));

const questions = (JSON.parse(readFileSync(join(ROOT, "evals", "questions.json"), "utf8")) as EvalQuestion[]).filter((q) => only.length === 0 || only.includes(q.id));
const dir = join(ROOT, "runs", runName);
mkdirSync(dir, { recursive: true });
const resultsPath = join(dir, "results.jsonl");
const done: Row[] = existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const key = (qid: string, s: string, m: string, t: number) => `${qid}|${s}|${m}|${t}`;
const finished = new Set(done.map((r) => key(r.qid, r.strategy, r.model, r.trial)));

const corpus = new Corpus();
const nMessages = (openDb().query("SELECT count(*) AS n FROM messages").get() as { n: number }).n;
const cells = questions.flatMap((q) => strategies.flatMap((s) => Array.from({ length: trials }, (_, t) => ({ q, s, t })))).filter((c) => !finished.has(key(c.q.id, c.s, model, c.t)));
console.log(`${cells.length} cells to run (${finished.size} already done), model ${model}, concurrency ${concurrency}`);

let next = 0;
async function worker() {
  while (next < cells.length) {
    const { q, s, t } = cells[next++];
    const result = await runStrategy(s, q.question, corpus, nMessages, model);
    const row: Row = { qid: q.id, kind: q.kind, strategy: s, model, trial: t, correct: isCorrect(q, result), result };
    appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    done.push(row);
    console.log(`${row.correct ? "PASS" : "FAIL"} ${q.id} ${s} ${(result.latencyMs / 1000).toFixed(1)}s tools=${result.toolCalls} answer=${JSON.stringify(result.answer).slice(0, 80)} gold=${q.answerType === "message" ? q.gold.slice(0, 2).join(",") : q.answer}${result.error ? ` ERROR=${result.error}` : ""}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const summary = summarize(done);
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(dir, "report.md"), `# Run ${runName}\n\n${markdownTable(summary)}\n`);
console.log(markdownTable(summary));
process.exit(0);
