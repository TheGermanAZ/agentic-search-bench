// Two kinds of LLM judgment for "find the email" questions, cached in evals/:
// 1. Relevance (pooled): does a cited message state the answering fact? The seed email is often a
//    reply that quotes the original, so the original is an equally right citation. Every message any
//    strategy cited is judged once, and every strategy is scored against the same pool. A second judge
//    on a different model labels the same pairs so the agreement rate can be reported.
// 2. Answer: does the strategy's ANSWER line agree with the reference answer?
// Usage: bun run src/judge.ts --run=main [--run=latency]
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalQuestion } from "./build-evals";
import { ROOT, openDb, readBody } from "./corpus";
import type { Row } from "./score";

export const JUDGMENTS_PATH = join(ROOT, "evals", "judgments.json");
const SECOND_PATH = join(ROOT, "evals", "judgments-second.json");
const ANSWERS_PATH = join(ROOT, "evals", "answer-judgments.json");
export type Judgments = Record<string, Record<string, boolean>>;

const load = (p: string): Judgments => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
export const loadJudgments = () => load(JUDGMENTS_PATH);
export const loadAnswerJudgments = () => load(ANSWERS_PATH);

async function ask(model: string, prompt: string): Promise<boolean> {
  let text = "";
  for await (const m of query({ prompt, options: { model, tools: [], allowedTools: [], maxTurns: 1, settingSources: [], persistSession: false } })) {
    if (m.type === "result" && m.subtype === "success") text = m.result;
  }
  return /^\s*YES/i.test(text);
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) await f(items[next++]); }));
}

if (process.argv[1] && import.meta.filename === (await import("node:fs")).realpathSync(process.argv[1])) {
  const runs = process.argv.filter((a) => a.startsWith("--run=")).map((a) => a.slice(6));
  const questions = new Map((JSON.parse(readFileSync(join(ROOT, "evals", "questions.json"), "utf8")) as EvalQuestion[]).map((q) => [q.id, q]));
  const rows = runs.flatMap((run) => readFileSync(join(ROOT, "runs", run, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row));
  const semantic = rows.filter((r) => questions.get(r.qid)?.kind === "semantic");
  const db = openDb();
  const first = load(JUDGMENTS_PATH);
  const second = load(SECOND_PATH);
  const answers = load(ANSWERS_PATH);

  const relevancePrompt = (q: EvalQuestion, id: string) => {
    const [meta] = db.query("SELECT date, from_addr, subject FROM messages WHERE id = ?").all(id) as { date: string; from_addr: string; subject: string }[];
    const body = readBody(db, id);
    if (!meta || body === null) return null;
    return `Question: ${q.question}\nReference answer: ${q.answer}\n\nCandidate message:\nDate: ${meta.date}\nFrom: ${meta.from_addr}\nSubject: ${meta.subject}\n\n${body.slice(0, 8000)}\n\nDoes this message itself state the fact that answers the question, consistent with the reference answer? Quoted text inside the message counts. Reply with exactly YES or NO.`;
  };
  const pairs = [...new Set(semantic.flatMap((r) => r.result.sources.filter((s) => !questions.get(r.qid)?.gold.includes(s)).map((s) => `${r.qid}|${s}`)))].map((k) => k.split("|") as [string, string]);
  const todo = pairs.filter(([qid, id]) => first[qid]?.[id] === undefined || second[qid]?.[id] === undefined);
  console.log(`relevance: ${pairs.length} pairs, ${todo.length} to judge`);
  await pool(todo, 6, async ([qid, id]) => {
    const prompt = relevancePrompt(questions.get(qid) as EvalQuestion, id);
    const a = first[qid]?.[id] ?? (prompt ? await ask("claude-sonnet-5-5", prompt) : false);
    const b = second[qid]?.[id] ?? (prompt ? await ask("claude-opus-5-5", prompt) : false);
    first[qid] = { ...(first[qid] ?? {}), [id]: a };
    second[qid] = { ...(second[qid] ?? {}), [id]: b };
  });
  const agree = pairs.filter(([qid, id]) => first[qid]?.[id] === second[qid]?.[id]).length;
  console.log(`relevance agreement between sonnet and opus judges: ${agree}/${pairs.length}`);
  for (const [qid, id] of pairs) if (first[qid]?.[id] !== second[qid]?.[id]) console.log(`  disagree ${qid} ${id}: sonnet=${first[qid]?.[id]} opus=${second[qid]?.[id]}`);

  const answerTodo = [...new Set(semantic.map((r) => `${r.qid}\u0000${r.result.answer}`))].map((k) => k.split("\u0000") as [string, string]).filter(([qid, a]) => answers[qid]?.[a] === undefined);
  console.log(`answers: ${answerTodo.length} to judge`);
  await pool(answerTodo, 6, async ([qid, a]) => {
    const q = questions.get(qid) as EvalQuestion;
    const ok = a.trim() ? await ask("claude-sonnet-5-5", `Question: ${q.question}\nReference answer: ${q.answer}\nCandidate answer: ${a}\n\nDoes the candidate answer give the same key fact as the reference answer? Extra correct detail is fine. A refusal, "unknown", or a different fact is NO. Reply with exactly YES or NO.`) : false;
    answers[qid] = { ...(answers[qid] ?? {}), [a]: ok };
  });
  writeFileSync(JUDGMENTS_PATH, `${JSON.stringify(first, null, 2)}\n`);
  writeFileSync(SECOND_PATH, `${JSON.stringify(second, null, 2)}\n`);
  writeFileSync(ANSWERS_PATH, `${JSON.stringify(answers, null, 2)}\n`);
}
