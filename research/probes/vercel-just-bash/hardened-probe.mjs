// Hardened probe worker (research/probes/RUBRIC.md): runs one probe against just-bash with the project's
// own "hardened" execution-limit profile and prints one JSON object to stdout.
// Usage: node hardened-probe.mjs <probe>. hardened-run.mjs supplies PROBE_SECRET and the 120 s / 4 GB stop rules.
// Every Bash here gets HARDENED: executionLimitProfile "hardened" (limits.ts:218-261), no network/fetch option
// (network off, Bash.ts:174-179), python off (Bash.ts:180-185), default InMemoryFs, defenseInDepth default on.
// The *js probes add javascript.invokeTool, which enables js-exec (Bash.ts:131-132); nothing else changes.
import { Bash, defineCommand } from "just-bash";

const HARDENED = { executionLimitProfile: "hardened" };
const probe = process.argv[2];

let hostCalls = 0;
let inFlight = 0;
let maxInFlight = 0;
async function lookupOnHost(id) {
  hostCalls += 1;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 200));
  inFlight -= 1;
  return { id, value: id * 2 };
}
async function invokeTool(path, argsJson) {
  if (path !== "lookup") throw new Error(`unknown tool ${path}`);
  return JSON.stringify(await lookupOnHost(JSON.parse(argsJson).id));
}
const lookup = defineCommand("lookup", async (args) => {
  const result = await lookupOnHost(Number(args[0]));
  return { stdout: `${JSON.stringify(result)}\n`, stderr: "", exitCode: 0 };
});

const shell = (extra = {}) => new Bash({ ...HARDENED, ...extra });
const js = (extra = {}) => new Bash({ ...HARDENED, javascript: { invokeTool }, ...extra });

async function run(bash, script) {
  const start = performance.now();
  try {
    const r = await bash.exec(script);
    return { script, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, ms: Math.round(performance.now() - start), hostCalls };
  } catch (error) {
    return { script, threw: String(error?.stack ?? error), ms: Math.round(performance.now() - start), hostCalls };
  }
}
const seq = async (bash, scripts) => {
  const runs = [];
  for (const s of scripts) runs.push(await run(bash, s));
  return runs;
};

const out = { probe, config: HARDENED, host: { node: process.version, pid: process.pid } };

// P7 and P7js: the memory probe, then a concurrent session and a trivial execution in the same process (gate G3).
async function memoryProbe(make, script) {
  const bash = make();
  const other = make();
  const concurrent = make === js
    ? run(other, "js-exec -c 'let s = 0; for (let i = 1; i <= 3; i++) s += tools.lookup({id: i}).value; console.log(s)'")
    : run(other, "for i in 1 2 3; do lookup $i; done | wc -l");
  const [p7, concurrentRun] = await Promise.all([run(bash, script), concurrent]);
  const sameInstanceAfter = await run(bash, make === js ? "js-exec -c 'console.log(1 + 1)'" : "echo $((1 + 1))");
  const freshInstanceAfter = await run(make(), make === js ? "js-exec -c 'console.log(1 + 1)'" : "echo $((1 + 1))");
  return { runs: [p7], concurrentSession: concurrentRun, sameInstanceAfter, freshInstanceAfter };
}

switch (probe) {
  case "P1":
    out.runs = [await run(shell({ customCommands: [lookup] }), "lookup 21 | jq -r .value")];
    break;
  case "P1js":
    out.runs = [await run(js(), "js-exec -c 'const r = await tools.lookup({id: 21}); console.log(r.value)'")];
    break;
  case "P3":
    out.runs = await seq(shell(), ["curl https://example.com", "wget -qO- https://example.com"]);
    break;
  case "P3js":
    out.runs = [await run(js(), "js-exec -c 'const r = await fetch(\"https://example.com\"); console.log(r.status)'")];
    break;
  case "P4":
    out.runs = await seq(shell(), ["cat /etc/hosts", "ls /etc | head -5"]);
    break;
  case "P4js":
    out.runs = [await run(js(), "js-exec -c 'console.log(require(\"fs\").readFileSync(\"/etc/hosts\", \"utf8\").slice(0, 60))'")];
    break;
  case "P5":
    out.runs = await seq(shell(), ['echo "[$PROBE_SECRET]"', 'printenv PROBE_SECRET; echo "exit=$?"']);
    break;
  case "P5js":
    out.runs = [await run(js(), "js-exec -c 'console.log(\"[\" + process.env.PROBE_SECRET + \"]\")'")];
    break;
  case "P6":
    out.runs = [await run(shell(), "while true; do :; done")];
    break;
  case "P6js":
    out.runs = [await run(js(), "js-exec -c 'while (true) {}'")];
    break;
  case "P6jsNormal":
    // Control, not the hardened config: the normal profile (maxJsTimeoutMs 30 s) shows whether the ~1 s stop tracks the timeout.
    out.config = { profile: "normal" };
    out.runs = [await run(new Bash({ javascript: { invokeTool } }), "js-exec -c 'while (true) {}'")];
    break;
  case "P6deadline":
    // Not the hardened config: both counters raised so only the hardened 30 s maxExecutionTimeMs deadline can stop the loop.
    out.runs = [await run(shell({ executionLimits: { maxCommandCount: 1e9, maxLoopIterations: 1e9 } }), "while true; do :; done")];
    break;
  case "P7":
    Object.assign(out, await memoryProbe(() => shell({ customCommands: [lookup] }), "s=xxxxxxxxxxxxxxxx; while true; do s=\"$s$s\"; done; echo ${#s}"));
    break;
  case "P7js":
    Object.assign(out, await memoryProbe(js, "js-exec -c 'const a = []; while (true) a.push(\"x\".repeat(1e6))'"));
    break;
  case "P9": {
    out.runs = [await run(shell({ customCommands: [lookup] }), "lookup 1 & lookup 2 & lookup 3 & lookup 4 & lookup 5 & wait; echo done")];
    break;
  }
  case "P9js":
    out.runs = [await run(js(), "js-exec -c 'const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id: i}))); console.log(Date.now() - t)'")];
    break;
  case "P12":
    out.runs = await seq(shell(), [
      "node -e 'console.log(process.pid)'",
      "js-exec -c 'console.log(process.pid)'",
      "sh -c 'echo inner-sh'",
      "bash -c 'echo inner-bash'",
      "eval 'echo inner-eval'",
      "process",
      "require fs",
      "python3 -c 'import os; os.system(\"echo PWNED\")'",
      "echo \"$$ $BASHPID\"",
    ]);
    break;
  case "P12js":
    out.runs = await seq(js(), [
      "js-exec -c 'console.log(this.constructor.constructor(\"return process\")().pid)'",
      "js-exec -c 'console.log((function(){ return this })().process)'",
      "js-exec -c 'console.log(typeof require, typeof process, process.pid, process.env.PROBE_SECRET)'",
      "js-exec -c 'console.log(require(\"child_process\").execSync(\"echo inner-child\").toString())'",
    ]);
    break;
  default:
    throw new Error(`unknown probe ${probe}`);
}

out.peakRssKb = process.resourceUsage().maxRSS;
out.maxInFlight = maxInFlight;
out.hostCalls = hostCalls;
process.stdout.write(`${JSON.stringify(out)}\n`);
