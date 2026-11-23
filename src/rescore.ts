// Re-scores a finished run against the questions plus pooled judgments. Usage: bun run src/rescore.ts --run=main
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalQuestion } from "./build-evals";
import { ROOT } from "./corpus";
import { loadAnswerJudgments, loadJudgments } from "./judge";
import { type Row, isCorrect, markdownTable, summarize } from "./score";

const run = process.argv.find((a) => a.startsWith("--run="))?.slice(6) ?? "main";
const dir = join(ROOT, "runs", run);
const questions = new Map((JSON.parse(readFileSync(join(ROOT, "evals", "questions.json"), "utf8")) as EvalQuestion[]).map((q) => [q.id, q]));
const judged = loadJudgments();
const answers = loadAnswerJudgments();
const rows = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);
const q = (r: Row) => questions.get(r.qid) as EvalQuestion;
const rescored = rows.map((r) => ({ ...r, correct: isCorrect(q(r), r.result, judged, answers) }));
const strict = summarize(rows.map((r) => ({ ...r, correct: isCorrect(q(r), r.result, {}, answers) })));
const pooled = summarize(rescored);
writeFileSync(join(dir, "summary.json"), `${JSON.stringify({ pooled, strict }, null, 2)}\n`);
writeFileSync(join(dir, "report.md"), `# Run ${run}\n\n## Scored against seed gold plus pooled judgments\n\n${markdownTable(pooled)}\n\n## Scored against seed gold only (strict)\n\n${markdownTable(strict)}\n`);
console.log(markdownTable(pooled));
