// Checks that a huge final value or error text is capped like printed output (LIMITS.maxOutput) on the py-* engines.
// Usage: pnpm exec tsx research/probes/engines/py-caps.ts    Writes out/<engine>/caps.txt.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEngine } from "../../../src/engines";
import type { Corpus } from "../../../src/search";

const cases: Record<string, string[]> = {
  "py-monty": ['"A" * 200000', 'print("x" * 100000)\nraise ValueError("B" * 200000)'],
  "py-fastmcp": ['return "A" * 200000', 'try:\n    raise ValueError("B" * 200000)\nexcept Exception as e:\n    return str(e)'],
  "py-pydantic-ai": ['"A" * 200000', 'print("x" * 100000)\nraise ValueError("boom")'],
};
for (const [name, codes] of Object.entries(cases)) {
  const engine = await getEngine(name);
  const lines: string[] = [];
  for (const code of codes) {
    const out = await engine.run(code, {} as Corpus);
    lines.push(`${JSON.stringify(code)}\n  chars back: ${out.length}; tail: ${JSON.stringify(out.slice(-140))}`);
  }
  writeFileSync(join(import.meta.dirname, "out", name, "caps.txt"), `${lines.join("\n")}\n`);
  console.log(`${name}\n${lines.join("\n")}`);
  await engine.close?.();
}
process.exit(0);
