// Builds research/probes/results/vercel-just-bash.json from out/summary.json, the repeat files, and the source notes below.
// Usage: node build-results.mjs   (run after node run.mjs and the repeat scripts)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out");
const RESULTS = join(here, "..", "results", "vercel-just-bash.json");
const SHA = "ec5ab766551d479f2782b078b373d49ddc78bd26";
const BASE = `https://github.com/vercel-labs/just-bash/blob/${SHA}`;
const CORE = `${BASE}/packages/just-bash/src`;
const EVIDENCE = "research/probes/vercel-just-bash/out";

const summary = JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8"));
const repeats = (id) => JSON.parse(readFileSync(join(OUT, `${id}-repeats.json`), "utf8"));
const range = (values) => `${Math.min(...values)} to ${Math.max(...values)}`;

const p6 = repeats("P6").rows;
const p7 = repeats("P7").rows;
const p11 = repeats("P11").rows;
const ablate = JSON.parse(readFileSync(join(OUT, "ablate-defense.json"), "utf8"));

const detail = {
  P1: `${summary.P1.detail}. JS variant (js-exec with invokeTool): ${summary.P1js.detail}.`,
  P2: summary.P2.detail,
  P3: summary.P3.detail,
  P4: summary.P4.detail,
  P5: summary.P5.detail,
  P6: `${summary.P6.detail}. Five separate runs: ${range(p6.map((r) => r.execMs))} ms in-sandbox. The count is the limiter, not the 60 min deadline. Raising only maxCommandCount stops on the loop cap at ${summary.P6c.detail.match(/after (\d+) ms/)[1]} ms. With both counters raised, the loop was still running at 120 s when the driver killed it (P6b).`,
  P7: `${summary.P7.detail}. Five separate runs: ${range(p7.map((r) => r.execMs))} ms, peak RSS ${range(p7.map((r) => r.peakRssKb))} KB. The limiter is maxStringLength (64 MiB), reached before the 512 MiB live-bytes cap and the 4 GB driver kill.`,
  P8: summary.P8.detail,
  P9: `${summary.P9.detail}. JS variant (Promise.all over tools.lookup): ${summary.P9js.detail}.`,
  P10: `${summary.P10.detail} Host command throw (P10b): ${summary.P10b.detail}. JS uncaught throw (P10js): ${summary.P10js.detail}.`,
  P11: `${summary.P11.detail} Five separate processes, same-instance median ${range(p11.map((r) => Number(r.sameInstance.median.toFixed(3))))} ms, fresh-instance median ${range(p11.map((r) => Number(r.freshInstance.median.toFixed(3))))} ms. Defense-in-depth ablation (5 alternating rounds, 2000 execs each): ${ablate.onMsPerExecMedian} ms per exec on, ${ablate.offMsPerExecMedian} ms off. Load average was 36 to 107 on 14 cores during these runs, so absolute times are inflated.`,
  P12: `${summary.P12.detail}. JS variant (js-exec with javascript: true): ${summary.P12js.detail}.`,
};

const evidence = Object.fromEntries(
  ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"].map((id) => {
    const extra = {
      P1: "P1js.txt",
      P6: "P6-repeats.json",
      P7: "P7-repeats.json",
      P9: "P9js.txt",
      P10: "P10b.txt, P10js.txt",
      P11: "P11-repeats.json, ablate-defense.json, profile/top-self-time.txt",
      P12: "P12js.txt",
    }[id];
    return [id, `${EVIDENCE}/${id}.txt${extra ? ` (also ${EVIDENCE}/${extra})` : ""}`];
  }),
);

const probes = Object.fromEntries(
  ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"].map((id) => [
    id,
    { outcome: summary[id].outcome, detail: detail[id], evidence: evidence[id] },
  ]),
);

const results = {
  impl: "vercel-just-bash",
  name: "Vercel just-bash",
  source: "https://github.com/vercel-labs/just-bash (npm: just-bash)",
  pinned: `source ${SHA}; ran npm just-bash@3.6.1 (same version as packages/just-bash/package.json at that commit)`,
  language: "Bash (shell script); JS only when javascript is enabled (js-exec, QuickJS); Python off by default",
  engine:
    "Shell: a TypeScript AST interpreter running in the Node.js host realm, with no VM, worker, or process boundary. JS (js-exec): QuickJS compiled to WASM through the run package, with a 64 MiB guest memory cap. Python: CPython on WASM, disabled by default.",
  how_run:
    "new Bash(options) from the package root import { Bash } from \"just-bash\" (the same import bash-tool uses), then await bash.exec(script); host functions registered via customCommands (shell) and javascript.invokeTool (JS).",
  probes,
  defaults: {
    time: "normal profile maxExecutionTimeMs 3,600,000 ms (60 min) (limits.ts#L201); hardened 30 s. Loops stop sooner on maxCommandCount and maxLoopIterations (100,000 each). js-exec deadline maxJsTimeoutMs 30 s (limits.ts#L205).",
    memory: "maxStringLength 64 MiB (limits.ts#L208); maxLiveBytes 512 MiB (limits.ts#L189); in-memory filesystem maxFileSystemBytes 1 GiB (limits.ts#L191); js-exec guest 64 MiB (run-runtime.ts#L74). Host heap is not capped by just-bash.",
    output: "maxOutputSize 256 MiB, aggregate stdout plus stderr (limits.ts#L213). Over the limit the result keeps partial stdout, exit 126, and an error line. No truncation marker.",
    tool_calls: "maxCommandCount 100,000 per exec, shared across nested exec, charged per pipeline command (execution-scope.ts#L95-L96, pipeline-execution.ts#L97). No separate host tool counter for shell commands. js-exec bridge cap maxJsBridgeRequests 1,000,000 (limits.ts#L206).",
  },
  source_notes: [
    {
      topic: "API shape",
      finding:
        "Shell host functions are plain commands. defineCommand(name, execute(args, ctx)) returns {name, trusted, execute} (no schema, no codegen; the host parses args itself), and the constructor registers each customCommands entry. JS side: a Proxy named tools turns tools.a.b(args) into invokeTool(\"a.b\", JSON), also without codegen. just-bash-executor createExecutor generates commands and invokeTool from inline or SDK tools (read, not run).",
      evidence: `${CORE}/custom-commands.ts#L100-L106; ${CORE}/Bash.ts#L549-L557; ${CORE}/commands/js-exec/run-runtime.ts#L590-L603; ${BASE}/packages/just-bash-executor/src/create-executor.ts#L76-L118`,
    },
    {
      topic: "Discovery",
      finding:
        "Everything is eager. Shell custom commands are registered at construction, so every name is known up front and nothing is searched or read on demand. The js-exec tools Proxy accepts any property path, so the guest cannot list tools at all. just-bash-executor lists every tool with sdk.tools.list() and exposes all of them as commands.",
      evidence: `${CORE}/Bash.ts#L549-L557; ${CORE}/commands/js-exec/run-runtime.ts#L590-L603; ${BASE}/packages/just-bash-executor/src/create-executor.ts#L127-L131`,
    },
    {
      topic: "Bridge",
      finding:
        "A shell host command is a direct async call in the same Node realm (custom-commands.ts#L199) and, when trusted, runs under runTrustedAsync (builtin-dispatch.ts#L1020-L1022). For JS, the guest calls host.invokeTool synchronously (run-runtime.ts#L601) and the host binding awaits the callback (run-runtime.ts#L1013-L1020). Guest code runs in QuickJS from the run package (run-runtime.ts#L3-L11). The child_process shim in js-exec calls back into the sandboxed shell (run-runtime.ts#L543-L558, #L974-L1005), not into Node.",
      evidence: `${CORE}/custom-commands.ts#L199; ${CORE}/interpreter/builtin-dispatch.ts#L1020-L1022; ${CORE}/commands/js-exec/run-runtime.ts#L601; ${CORE}/commands/js-exec/run-runtime.ts#L1013-L1020`,
    },
    {
      topic: "Isolation boundary",
      finding:
        "Shell: no separate engine. Bash.exec (Bash.ts#L631) runs a TypeScript AST interpreter in the host realm, with no VM, worker, or process boundary. JS: QuickJS-in-WASM via run. The README Security Model says \"All execution happens without VM isolation\" (README.md#L697), and the code matches that. THREAT_MODEL.md#L5 calls it \"a secure, sandboxed bash environment\", which the code does not back up as an OS-level boundary. Defense-in-depth is on by default (Bash.ts#L412) and patches globals on each execution (defense-in-depth-box.ts#L597). THREAT_MODEL.md#L164 says child_process is \"Not imported anywhere\", but cli/exec.ts#L25 imports spawnSync from node:child_process. That file is the host CLI, not the sandbox path, so the sandbox claim holds.",
      evidence: `${CORE}/Bash.ts#L631; ${BASE}/packages/just-bash/README.md#L697; ${BASE}/THREAT_MODEL.md#L5; ${BASE}/THREAT_MODEL.md#L164; ${CORE}/Bash.ts#L412; ${CORE}/security/defense-in-depth-box.ts#L597; ${CORE}/cli/exec.ts#L25`,
    },
    {
      topic: "Output channel",
      finding:
        "The result is {stdout, stderr, exitCode, env}. Shell scripts have no return value, so the only output channel is stdout and stderr. Bash.ts, execution-scope.ts, control-flow.ts, and pipeline-execution.ts contain no truncation marker. Output above maxOutputSize throws ExecutionLimitError, and the caller gets the partial stdout with exit 126 (observed: 240 MB kept, no END line, P2b).",
      evidence: `${CORE}/execution-scope.ts#L250-L253; ${CORE}/Bash.ts#L963-L969; ${CORE}/Bash.ts#L1023-L1029`,
    },
    {
      topic: "Limits",
      finding:
        "Normal profile (the default): maxCallDepth 100 (limits.ts#L166), maxCommandCount 100,000 (#L167), maxLoopIterations 100,000 (#L168), maxLiveBytes 512 MiB (#L189), maxExecutionTimeMs 3,600,000 (#L201), maxJsTimeoutMs 30 s (#L205), maxJsBridgeRequests 1e6 (#L206), maxStringLength 64 MiB (#L208), maxOutputSize 256 MiB (#L213). Hardened profile at limits.ts#L218-L262 (commands 10,000 at #L221, time 30 s at #L260). The profile defaults to normal in resolveLimits (limits.ts#L266-L268), and the Bash constructor passes executionLimitProfile through (Bash.ts#L354-L371).",
      evidence: `${CORE}/limits.ts#L163-L215; ${CORE}/limits.ts#L218-L262; ${CORE}/limits.ts#L266-L275; ${CORE}/Bash.ts#L354-L371`,
    },
    {
      topic: "State",
      finding:
        "Fresh per exec. Each exec copies the instance env into a new Map (Bash.ts#L745-L747) and nothing writes that copy back; the instance state is assigned only in the constructor (Bash.ts#L418). The InMemoryFs is created once per instance (Bash.ts#L374) and shared across calls, as README.md#L25 says. Observed: variables and cwd reset, files persist (P8). No snapshot or serialization API was found in Bash.ts or sandbox/.",
      evidence: `${CORE}/Bash.ts#L745-L747; ${CORE}/Bash.ts#L418; ${CORE}/Bash.ts#L374; ${BASE}/packages/just-bash/README.md#L25`,
    },
    {
      topic: "Errors",
      finding:
        "ExecutionLimitError becomes exit 126 with sanitized stderr and the partial stdout (Bash.ts#L963-L969, errors.ts#L201-L205). Other command errors become stderr text prefixed with the command name, and the script continues (builtin-dispatch.ts#L1030-L1041; observed \"boom: probe-boom\", P10b). Parse errors exit 2 with \"Parse error at 1:1\" (observed, P10). A host command throw does not reject exec. A JS uncaught throw gives \"at <eval> (-c:L:C): message\" and exit 1 (observed, P10js).",
      evidence: `${CORE}/Bash.ts#L963-L969; ${CORE}/interpreter/errors.ts#L201-L205; ${CORE}/interpreter/builtin-dispatch.ts#L1030-L1041`,
    },
    {
      topic: "Anything else",
      finding:
        "(a) '&' is parsed (parser.ts#L531-L535), but the interpreter never reads the background flag, and wait is a stub (builtin-dispatch.ts#L643-L645), so concurrent-looking code runs serially (P9). (b) The JS invokeTool bridge is synchronous, so Promise.all over tools is serial (run-runtime.ts#L601, P9js). (c) Network is off by default and allow-listed by URL prefix (network/types.ts#L56-L82). Header transforms inject credentials at the fetch boundary so the secret never enters the sandbox (README.md#L392). (d) Python is off by default (Bash.ts#L521-L525). (e) The executor onToolApproval gate applies only to SDK tools; inline tools skip it (create-executor.ts#L189-L190). (f) The package requires Node >=20.19 (packages/just-bash/package.json#L15).",
      evidence: `${CORE}/parser/parser.ts#L531-L535; ${CORE}/interpreter/builtin-dispatch.ts#L643-L645; ${CORE}/network/types.ts#L56-L82; ${BASE}/packages/just-bash-executor/src/create-executor.ts#L189-L190; ${BASE}/packages/just-bash/package.json#L15`,
    },
  ],
  surprises: [
    "The default time limit is 60 minutes (limits.ts#L201), not 30 seconds. The README Execution Protection example uses 30 s under the hardened profile, and a reader would expect a time limit by default. In practice an infinite shell loop stops in about 0.4 s on the 100,000 command cap (P6). With both counters raised, the loop ran past 120 s (P6b).",
    "'&' is parsed but never runs concurrently, and wait is a no-op (parser.ts#L531-L535, builtin-dispatch.ts#L643-L645). Five 200 ms lookups took about 1 s with max in flight 1 (P9). Nothing in the output says the background jobs ran in the foreground.",
    "The JS tool bridge is synchronous (run-runtime.ts#L601), so Promise.all over tools.lookup runs one call at a time (P9js, max in flight 1). In-guest Date.now() printed 1 ms while the host measured 1176 ms, so guest timers mislead about elapsed time.",
    "A failing host command does not fail the script. 'boom; echo after-boom' resolves with exit 0 and the error only on stderr. 'boom' alone exits 1 (P10b).",
    "The README calls defense-in-depth 'Secondary', but it is on by default (Bash.ts#L412) and costs most of the per-exec time: 0.160 ms per exec with it on and 0.033 ms off, 5 alternating rounds (out/ablate-defense.json). applyPatches, applyPatch, restorePatches, and protectReversibleIntrinsics take about 21% of self time in the CPU profile (out/profile/top-self-time.txt).",
    "The output limit does not truncate. 240 MB of stdout came back with exit 126 and the final END line missing, and the only signal is the stderr error (P2b, Bash.ts#L963-L969).",
    "THREAT_MODEL.md#L5 says 'secure, sandboxed bash environment', while README.md#L697 says 'All execution happens without VM isolation'. The code matches the README. The threat model also says child_process is 'Not imported anywhere' (THREAT_MODEL.md#L164), but cli/exec.ts#L25 imports it in the host CLI.",
    "The just-bash-executor README calls onToolApproval a 'pre-invocation gate' (packages/just-bash-executor/README.md#L224), but inline tools bypass it (create-executor.ts#L189-L190). Source only; the executor was not run.",
    "python3 with python disabled on Node says 'command not available in browser environments' and tells the user to use the Node.js bundle (builtin-dispatch.ts#L818-L824, browser-excluded.ts#L17). That message is wrong for a Node host.",
    "Inside js-exec, process.env is the virtual environment (HOME, PATH, ...), and require('child_process').execSync runs in the sandboxed shell (P12js). Both are the designed behavior, but a reader may expect them to reach Node.",
  ],
};

// Expands shorthand file#Lnn references in the surprise strings into full permalinks.
const REPO_PATHS = {
  "Bash.ts": "packages/just-bash/src/Bash.ts",
  "custom-commands.ts": "packages/just-bash/src/custom-commands.ts",
  "execution-scope.ts": "packages/just-bash/src/execution-scope.ts",
  "limits.ts": "packages/just-bash/src/limits.ts",
  "parser.ts": "packages/just-bash/src/parser/parser.ts",
  "builtin-dispatch.ts": "packages/just-bash/src/interpreter/builtin-dispatch.ts",
  "errors.ts": "packages/just-bash/src/interpreter/errors.ts",
  "pipeline-execution.ts": "packages/just-bash/src/interpreter/pipeline-execution.ts",
  "browser-excluded.ts": "packages/just-bash/src/commands/browser-excluded.ts",
  "run-runtime.ts": "packages/just-bash/src/commands/js-exec/run-runtime.ts",
  "defense-in-depth-box.ts": "packages/just-bash/src/security/defense-in-depth-box.ts",
  "types.ts": "packages/just-bash/src/network/types.ts",
  "exec.ts": "packages/just-bash/src/cli/exec.ts",
  "create-executor.ts": "packages/just-bash-executor/src/create-executor.ts",
  "README.md": "packages/just-bash/README.md",
  "THREAT_MODEL.md": "THREAT_MODEL.md",
  "package.json": "packages/just-bash/package.json",
};
const linkify = (text) =>
  text.replace(/(?:packages\/[\w.\/-]+|[\w.-]+(?:\/[\w.-]+)*)\.(?:ts|md|json)#L(\d+)(?:-L(\d+))?/g, (token) => {
    const [file, lines] = token.split("#");
    const path = file.includes("/") && file.startsWith("packages/") ? file : REPO_PATHS[file.split("/").pop()] ?? file;
    const [a, b] = lines.slice(1).split("-L");
    return `${BASE}/${path}#L${a}${b ? `-L${b}` : ""}`;
  });
results.surprises = results.surprises.map(linkify);
writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${RESULTS}`);
