// Live demo: pnpm ask --strategy=codemode [--engine=quickjs-asyncify] [--model=claude-sonnet-5-5] "Who did kenneth.lay@enron.com email most in October 2001?"
import { openDb } from "./corpus";
import { Corpus } from "./search";
import { STRATEGIES, type Strategy, runStrategy } from "./strategies";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const strategy = (flag("strategy") ?? "codemode") as Strategy;
const model = flag("model") ?? "claude-sonnet-5-5";
if (flag("engine")) process.env.CODEMODE_ENGINE = flag("engine");
const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (!question || !STRATEGIES.includes(strategy)) {
  console.error(`usage: pnpm ask --strategy=${STRATEGIES.join("|")} "question"`);
  process.exit(1);
}
const corpus = new Corpus();
const n = (openDb().query("SELECT count(*) AS n FROM messages").get() as { n: number }).n;
const r = await runStrategy(strategy, question, corpus, n, model);
for (const [i, t] of r.trace.entries()) {
  const input = JSON.parse(t.input) as Record<string, unknown>;
  console.log(`\n── call ${i + 1}: ${t.tool} (${t.resultChars.toLocaleString("en-US")} chars back)`);
  console.log(typeof input.code === "string" ? input.code : JSON.stringify(input, null, 2));
}
console.log(`\n${r.finalText}\n`);
console.log(`${strategy}${strategy === "codemode" ? ` (${process.env.CODEMODE_ENGINE ?? "vercel-run"})` : ""} on ${model}: ${(r.latencyMs / 1000).toFixed(1)}s, ${r.toolCalls} tool calls, ${r.inputTokens.toLocaleString("en-US")} input tokens, $${r.costUsd.toFixed(3)}${r.error ? `, error ${r.error}` : ""}`);
process.exit(0);
