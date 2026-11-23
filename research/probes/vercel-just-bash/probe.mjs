// Probe worker: runs one probe against a fresh just-bash sandbox and prints one JSON object to stdout.
// Usage: node probe.mjs <P1|P2|...|P12>
// The driver (run.mjs) supplies PROBE_SECRET in the environment and enforces the 120 s and 4 GB stop rules.
import { Bash, defineCommand } from "just-bash";

const probe = process.argv[2];
const HOST_SLEEP_MS = 200;

let hostCalls = 0;
let inFlight = 0;
let maxInFlight = 0;
async function lookupOnHost(id) {
  hostCalls += 1;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, HOST_SLEEP_MS));
  inFlight -= 1;
  return { id, value: id * 2 };
}

async function invokeToolOnHost(path, argsJson) {
  if (path !== "lookup") throw new Error(`unknown tool ${path}`);
  const { id } = JSON.parse(argsJson);
  return JSON.stringify(await lookupOnHost(id));
}

const boom = defineCommand("boom", async () => {
  throw new Error("probe-boom");
});

const lookup = defineCommand("lookup", async (args) => {
  const id = Number(args[0]);
  if (!Number.isFinite(id)) {
    return { stdout: "", stderr: "lookup: expected a numeric id\n", exitCode: 2 };
  }
  const result = await lookupOnHost(id);
  return { stdout: `${JSON.stringify(result)}\n`, stderr: "", exitCode: 0 };
});

async function run(bash, script, label = script) {
  const start = performance.now();
  let result;
  try {
    result = await bash.exec(script);
  } catch (error) {
    return {
      label,
      script,
      threw: String(error?.message ?? error),
      stackHead: String(error?.stack ?? "").split("\n").slice(0, 3).join(" | "),
      ms: Math.round(performance.now() - start),
      hostCalls,
    };
  }
  const ms = Math.round(performance.now() - start);
  return {
    label,
    script,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ms,
    stdoutLength: result.stdout.length,
    hostCalls,
  };
}

async function runSequence(bash, scripts) {
  const runs = [];
  for (const script of scripts) runs.push(await run(bash, script));
  return runs;
}

async function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { median: pick(50), p90: pick(90), min: sorted[0], max: sorted[sorted.length - 1] };
}

const out = { probe, host: { node: process.version, pid: process.pid } };

switch (probe) {
  case "P1": {
    const bash = new Bash({ customCommands: [lookup] });
    out.runs = [await run(bash, "lookup 21 | jq -r .value")];
    out.hostCalls = hostCalls;
    break;
  }
  case "P2": {
    const bash = new Bash();
    out.runs = [await run(bash, "printf '%200000s' | tr ' ' A; echo; echo RETURNED")];
    break;
  }
  case "P3": {
    out.runs = [await run(new Bash(), "curl https://example.com")];
    const allowlisted = new Bash({
      network: { allowedUrlPrefixes: ["https://example.com"] },
    });
    out.runs.push(await run(allowlisted, "curl -sS https://example.com | head -c 120"));
    break;
  }
  case "P4": {
    const bash = new Bash();
    out.runs = await runSequence(bash, ["cat /etc/hosts", "ls /etc | head -5"]);
    break;
  }
  case "P5": {
    const bash = new Bash();
    out.runs = await runSequence(bash, [
      'echo "[$PROBE_SECRET]"',
      'printenv PROBE_SECRET; echo "exit=$?"',
    ]);
    break;
  }
  case "P6": {
    const bash = new Bash();
    out.runs = [await run(bash, "while true; do :; done")];
    break;
  }
  case "P7": {
    const bash = new Bash();
    out.runs = [await run(bash, "s=xxxxxxxxxxxxxxxx; while true; do s=\"$s$s\"; done; echo ${#s}")];
    break;
  }
  case "P8": {
    const bash = new Bash();
    out.runs = [
      await run(bash, "kept=7", "exec 1: kept=7"),
      await run(bash, "echo ${kept:-gone}", "exec 2: echo ${kept:-gone}"),
      await run(bash, "echo persisted > /home/user/p8.txt", "exec 1b: write file"),
      await run(bash, "cat /home/user/p8.txt", "exec 2b: read file"),
      await run(bash, "cd /tmp", "exec 1c: cd /tmp"),
      await run(bash, "pwd", "exec 2c: pwd"),
    ];
    break;
  }
  case "P9": {
    const bash = new Bash({ customCommands: [lookup] });
    const script = "lookup 1 & lookup 2 & lookup 3 & lookup 4 & lookup 5 & wait; echo done";
    const start = performance.now();
    const result = await bash.exec(script);
    out.runs = [
      {
        label: script,
        script,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ms: Math.round(performance.now() - start),
        hostCalls,
      },
    ];
    break;
  }
  case "P10": {
    const bash = new Bash();
    out.runs = await runSequence(bash, ["nosuchcmd_probe_xyz", "exit 7", "echo )"]);
    break;
  }
  case "P11": {
    const setupStart = performance.now();
    const { Bash: FreshBash } = await import("just-bash");
    const shared = new FreshBash();
    const setupMs = Math.round((performance.now() - setupStart) * 100) / 100;
    const sameInstance = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const result = await shared.exec("echo 2");
      sameInstance.push({ ms: performance.now() - start, stdout: result.stdout, exitCode: result.exitCode });
    }
    const freshInstance = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const bash = new FreshBash();
      const result = await bash.exec("echo 2");
      freshInstance.push({ ms: performance.now() - start, stdout: result.stdout, exitCode: result.exitCode });
    }
    out.setupMs = setupMs;
    out.sameInstance = {
      ...(await percentiles(sameInstance.map((r) => r.ms))),
      samplesMs: sameInstance.map((r) => Math.round(r.ms * 100) / 100),
      allOutputs2: sameInstance.every((r) => r.stdout === "2\n" && r.exitCode === 0),
    };
    out.freshInstance = {
      ...(await percentiles(freshInstance.map((r) => r.ms))),
      samplesMs: freshInstance.map((r) => Math.round(r.ms * 100) / 100),
      allOutputs2: freshInstance.every((r) => r.stdout === "2\n" && r.exitCode === 0),
    };
    break;
  }
  case "P2b": {
    const bash = new Bash();
    out.runs = [await run(bash, "for i in 1 2 3 4 5; do printf '%60000000s' ''; done; echo END")];
    break;
  }
  case "P10b": {
    const bash = new Bash({ customCommands: [boom] });
    out.runs = [await run(bash, "boom; echo after-boom")];
    break;
  }
  case "P10js": {
    const bash = new Bash({ javascript: true });
    out.runs = await runSequence(bash, [
      "js-exec -c 'throw new Error(\"probe-boom\")'",
      "js-exec -c 'console.log(\"before\"); throw new Error(\"probe-boom\")'",
    ]);
    break;
  }
  case "P6c": {
    const bash = new Bash({ executionLimits: { maxCommandCount: 1_000_000_000 } });
    out.runs = [await run(bash, "while true; do :; done")];
    break;
  }
  case "P6b": {
    const bash = new Bash({
      executionLimits: { maxCommandCount: 1_000_000_000, maxLoopIterations: 1_000_000_000 },
    });
    out.runs = [await run(bash, "while true; do :; done")];
    break;
  }
  case "P1js": {
    const bash = new Bash({ javascript: { invokeTool: invokeToolOnHost } });
    out.runs = [await run(bash, "js-exec -c 'const r = await tools.lookup({id: 21}); console.log(r.value)'")];
    out.hostCalls = hostCalls;
    break;
  }
  case "P9js": {
    const bash = new Bash({ javascript: { invokeTool: invokeToolOnHost } });
    out.runs = [
      await run(
        bash,
        "js-exec -c 'const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id: i}))); console.log(Date.now() - t)'",
      ),
    ];
    break;
  }
  case "P12js": {
    const bash = new Bash({ javascript: true });
    out.runs = await runSequence(bash, [
      "js-exec -c 'console.log(this.constructor.constructor(\"return process\")().pid)'",
      "js-exec -c 'console.log((function(){ return this })().process)'",
      "js-exec -c 'console.log(typeof require, typeof process, process.env.PROBE_SECRET)'",
      "js-exec -c 'console.log(require(\"fs\").readFileSync(\"/etc/hosts\", \"utf8\").slice(0, 40))'",
      "js-exec -c 'console.log(require(\"child_process\").execSync(\"echo inner-child\").toString())'",
    ]);
    break;
  }
  case "P12": {
    const bash = new Bash();
    out.runs = await runSequence(bash, [
      "node -e 'console.log(process.pid)'",
      "js-exec 'console.log(process.pid)'",
      "sh -c 'echo inner-sh'",
      "bash -c 'echo inner-bash'",
      "/bin/sh -c 'echo inner-bin-sh'",
      "eval 'echo inner-eval'",
      "process",
      "require fs",
      "child_process",
      "python3 -c 'import os; os.system(\"echo PWNED\")'",
      "echo \"$$ $BASHPID\"",
    ]);
    break;
  }
  default:
    throw new Error(`unknown probe ${probe}`);
}

out.peakRssKb = process.resourceUsage().maxRSS;
out.maxInFlight = maxInFlight;
process.stdout.write(`${JSON.stringify(out)}\n`);
