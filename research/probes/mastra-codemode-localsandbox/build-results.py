"""Writes research/probes/results/mastra-codemode-<backend>.json for the four Mastra Code Mode backends.

Outcome words and detail strings were written by hand from the reviewed out/ files. Check them
against new output after any rerun of run-probes.mjs.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHA = "aa82a4a7858c637f654be24391ff306dcb568c00"
GH = f"https://github.com/mastra-ai/mastra/blob/{SHA}/"
CORE = GH + "packages/core/src/tools/code-mode/"
QJS = GH + "code-mode/quickjs/src/transport.ts"
IVM = GH + "code-mode/isolated-vm/src/transport.ts"
LOCAL = GH + "packages/core/src/workspace/sandbox/local-sandbox.ts"
SEAT = GH + "packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts"
E2B = GH + "workspaces/e2b/src/code-mode/transport.ts"
DOCS = "https://mastra.ai/docs/agents/code-mode"


def P(outcome, display, detail, evidence):
    return {"outcome": outcome, "detail": detail, "evidence": evidence, "display": display}


def ev(impl, name):
    return f"research/probes/{impl}/out/{name}.txt"


SHARED_NOTES = [
    {"topic": "API shape", "finding": "Each Mastra tool's input and output schema goes zod -> JSON Schema -> a TypeScript string, and becomes one `declare function external_<id>(input): Promise<output>` line with the tool description as a doc comment.", "evidence": CORE + "stub-generator.ts#L164-L186"},
    {"topic": "Discovery", "finding": "Everything upfront: createCodeModeInstructions joins a fixed usage contract and every stub into one instructions string for the system prompt. No search or lazy loading; the docs scope tools by making several createCodeMode instances instead.", "evidence": CORE + "stub-generator.ts#L189-L213"},
    {"topic": "Credentials", "finding": "Tools run on the host: each external_* call re-enters the real Mastra tool's execute with the outer tool's requestContext, mastra instance and workspace, and an allow-list rejects tool ids that were not exposed. Credentials the tool uses stay on the host side of the bridge.", "evidence": CORE + "code-mode.ts#L102-L119"},
    {"topic": "Defaults", "finding": "Timeout defaults to 30 s for every backend (DEFAULT_TIMEOUT). The tool id defaults to execute_typescript.", "evidence": CORE + "code-mode.ts#L20-L21"},
    {"topic": "Errors", "finding": "The result type declares error.line, but no transport ever sets it: the stdio runner, the isolated-vm envelope and the QuickJS envelope all copy only message and name. The model never sees a line number or stack.", "evidence": CORE + "types.ts#L50-L54; " + CORE + "runner.ts#L153-L157; " + IVM + "#L266-L270; " + QJS + "#L425-L429"},
    {"topic": "Output channel", "finding": "Both console output (logs[], one entry per call, in order) and the program's `return` value come back. Nothing truncates either; a bare final expression is not returned because the program is wrapped in an async function body.", "evidence": CORE + "transport.ts#L76-L80; " + CORE + "runner.ts#L38-L40"},
]

common = {
    "source": "npm @mastra/core 1.85.0 (createCodeMode from @mastra/core/tools); repo https://github.com/mastra-ai/mastra",
    "language": "TS (types stripped before running)",
}

results = {}

# ---------------- QuickJS ----------------
i = "mastra-codemode-quickjs"
results[i] = {
    "impl": i,
    "name": "Mastra Code Mode, QuickJS transport",
    **common,
    "source": common["source"] + "; npm @mastra/quickjs 0.1.5",
    "pinned": f"@mastra/core 1.85.0 + @mastra/quickjs 0.1.5 (quickjs-emscripten 0.31.0); source read at {SHA}",
    "engine": "QuickJS compiled to WASM (quickjs-emscripten sync build), in the host Node process; new runtime and context per run",
    "how_run": "createCodeMode({ tools: { lookup } }, new QuickJsCodeModeTransport()).tool.execute({ code }, {}), the same tool object an Agent gets",
    "probes": {
        "P1": P("works", "works (42, 1 call)", "printed 42 in logs, 1 host call, 220 ms", ev(i, "P1")),
        "P2": P("works", "works (200,000 chars, no cap)", "logs[] carried the full 200,000-char line, no marker. Spec form returns no result (bare last expression is not returned); with `return` the result is RETURNED", ev(i, "P2")),
        "P3": P("not-defined", "not-defined", "ReferenceError: 'fetch' is not defined", ev(i, "P3")),
        "P4": P("not-defined", "not-defined", "'require' is not defined; import(\"fs\") -> could not load module 'fs'; 'process' and 'Deno' not defined", ev(i, "P4")),
        "P5": P("not-defined", "not-defined", "ReferenceError: 'process' is not defined (host had PROBE_SECRET=s3cr3t)", ev(i, "P5")),
        "P6": P("limited", "limited (30 s; blocks host)", "TimeoutError 'Code Mode execution timed out after 30000ms' at 30,015 ms. The loop runs synchronously on the host thread: a 100 ms host timer fired 0 of 50 times during a 5 s run (hardened-P6x)", ev(i, "P6") + "; " + ev(i, "hardened-P6x")),
        "P7": P("limited", "limited (128 MB heap)", "InternalError 'out of memory' after 5.4 to 6.8 s; host survived and the next execution made a tool call (42). Host RSS still climbed to 1.2 to 1.6 GB and did not come back down", ev(i, "P7")),
        "P8": P("works", "fresh", "second execution printed gone", ev(i, "P8")),
        "P9": P("works", "parallel (204 ms)", "in-code elapsed 204 ms, 5 host calls, 221 ms wall", ev(i, "P9")),
        "P10": P("works", "message only (no line)", "error {message: 'probe-boom', name: 'Error'}; no stack or line, also for the three-line case", ev(i, "P10")),
        "P11": P("works", "0.7 ms median", "median 0.7 ms, p90 0.9 ms over 20 runs; first execution 18 ms (loads WASM); setup 179 ms", ev(i, "P11")),
        "P12": P("blocked", "blocked", "Function constructor: 'process' is not defined; sloppy this.process undefined; host canary undefined; only external_lookup among matching globals", ev(i, "P12")),
    },
    "hardened": {
        "config": "createCodeMode({ tools, timeout: 5000 }, new QuickJsCodeModeTransport({ memoryLimitMb: 32 })); options at " + CORE + "types.ts#L32-L33 and " + QJS + "#L66-L89",
        "probes": {
            "P3": P("not-defined", "not-defined", "'fetch' is not defined", ev(i, "hardened-P3")),
            "P4": P("not-defined", "not-defined", "require/process/Deno not defined; import('fs') could not load module", ev(i, "hardened-P4")),
            "P5": P("not-defined", "not-defined", "'process' is not defined", ev(i, "hardened-P5")),
            "P6": P("limited", "limited (5 s; blocks host)", "TimeoutError after 5,012 ms; host event loop blocked the whole time (0 of 50 timer ticks)", ev(i, "hardened-P6") + "; " + ev(i, "hardened-P6x")),
            "P7": P("limited", "limited (32 MB heap)", "'out of memory' after 12.5 s; host survived and made a tool call; host RSS 142 -> 785 MB over two runs", ev(i, "hardened-P7")),
            "P9": P("works", "parallel (203 ms)", "5 host calls in parallel", ev(i, "hardened-P9")),
            "P12": P("blocked", "blocked", "same as default", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s (createCodeMode default)", "memory": "128 MB QuickJS heap, 256 KB stack", "output": "no cap on logs or result", "tool_calls": "no cap"},
    "source_notes": [
        {"topic": "Bridge", "finding": "Uses the synchronous QuickJS build on purpose: each external_* call hands the guest a deferred promise and returns at once, and the host pumps the guest job queue when the dispatch settles, so Promise.all overlaps calls. The authors note the asyncify build cannot suspend twice.", "evidence": QJS + "#L29-L41; " + QJS + "#L325-L347"},
        {"topic": "Isolation boundary", "finding": "New QuickJS runtime and context per run, memory and stack limits set, bridge functions deleted from globalThis after bootstrap, console frozen. The guest sees only external_* closures.", "evidence": QJS + "#L229-L232; " + QJS + "#L359-L401"},
        {"topic": "Limits", "finding": "Time is enforced by an interrupt handler comparing Date.now() to the deadline, plus a host timer for time spent awaiting. The interrupt only fires between guest operations on the host thread, so the host event loop is blocked until then (P6x).", "evidence": QJS + "#L289-L305"},
    ] + SHARED_NOTES,
    "surprises": [
        "A runaway loop blocks the whole host Node event loop until the timeout (0 of 50 timer ticks in 5 s): on a server, every other request stalls for up to 30 s. The docs describe QuickJS only as slower than the other transports.",
        "memoryLimitMb caps the QuickJS heap, but host RSS rose to 1.2 to 1.6 GB under the 128 MB default and to 785 MB under 32 MB, and stayed there: the shared WASM module's memory does not shrink.",
        "error.line is in the result type but never filled, so the model gets no line numbers.",
        "The docs page gives no default for config.timeout; the code default is 30 s (types.ts:32).",
    ],
}

# ---------------- isolated-vm ----------------
i = "mastra-codemode-isolated-vm"
results[i] = {
    "impl": i,
    "name": "Mastra Code Mode, isolated-vm transport",
    **common,
    "source": common["source"] + "; npm @mastra/isolated-vm 0.1.4",
    "pinned": f"@mastra/core 1.85.0 + @mastra/isolated-vm 0.1.4 (isolated-vm 6.2.0 prebuilt darwin-arm64, esbuild 0.28.2); source read at {SHA}",
    "engine": "V8 isolate via isolated-vm, in the host Node process (needs --no-node-snapshot); new isolate per run",
    "how_run": "node --no-node-snapshot; createCodeMode({ tools: { lookup } }, new IsolatedVmCodeModeTransport()).tool.execute({ code }, {})",
    "probes": {
        "P1": P("works", "works (42, 1 call)", "printed 42, 1 host call, 237 ms", ev(i, "P1")),
        "P2": P("works", "works (200,000 chars, no cap)", "full 200,000-char log line, no marker; result only with `return`", ev(i, "P2")),
        "P3": P("not-defined", "not-defined", "ReferenceError: fetch is not defined", ev(i, "P3")),
        "P4": P("not-defined", "not-defined", "require is not defined; import('fs') -> 'Not supported'; process, Deno not defined", ev(i, "P4")),
        "P5": P("not-defined", "not-defined", "process is not defined", ev(i, "P5")),
        "P6": P("limited", "limited (30 s)", "TimeoutError after 30,037 ms; the host event loop kept running (50 of 51 timer ticks in the 5 s hardened-P6x run)", ev(i, "P6") + "; " + ev(i, "hardened-P6x")),
        "P7": P("limited", "limited (128 MB; 1/10 segv)", "'Isolate was disposed during execution due to memory limit' after 0.8 to 1.3 s; in 9 of 10 runs the host went on to make a tool call. In the first run the host process died with SIGSEGV (exit 139) right after the result came back", ev(i, "P7") + "; " + ev(i, "P7-run1-segv") + "; P7-rerun1..9"),
        "P8": P("works", "fresh", "second execution printed gone", ev(i, "P8")),
        "P9": P("works", "parallel (204 ms)", "in-code 204 ms, 5 host calls", ev(i, "P9")),
        "P10": P("works", "message only (no line)", "{message: 'probe-boom', name: 'Error'}; no stack or line", ev(i, "P10")),
        "P11": P("works", "1.6 ms median", "median 1.6 ms, p90 2.9 ms; first execution 35 ms; setup 84 ms", ev(i, "P11")),
        "P12": P("blocked", "blocked", "Function constructor: process is not defined; sloppy this.process undefined; host canary undefined", ev(i, "P12")),
    },
    "hardened": {
        "config": "createCodeMode({ tools, timeout: 5000 }, new IsolatedVmCodeModeTransport({ memoryLimitMb: 32 })); options at " + CORE + "types.ts#L32-L33 and " + IVM + "#L35-L41",
        "probes": {
            "P3": P("not-defined", "not-defined", "fetch is not defined", ev(i, "hardened-P3")),
            "P4": P("not-defined", "not-defined", "require not defined; import 'Not supported'", ev(i, "hardened-P4")),
            "P5": P("not-defined", "not-defined", "process is not defined", ev(i, "hardened-P5")),
            "P6": P("limited", "limited (5 s)", "TimeoutError after 5,042 ms; host loop not blocked", ev(i, "hardened-P6") + "; " + ev(i, "hardened-P6x")),
            "P7": P("limited", "limited (32 MB)", "isolate disposed at the memory limit after 152 to 172 ms; host made a tool call afterwards", ev(i, "hardened-P7")),
            "P9": P("works", "parallel (203 ms)", "5 host calls in parallel", ev(i, "hardened-P9")),
            "P12": P("blocked", "blocked", "same as default", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s (createCodeMode default), enforced by the eval timeout and a host timer", "memory": "128 MB V8 isolate heap", "output": "no cap on logs or result", "tool_calls": "no cap"},
    "source_notes": [
        {"topic": "Bridge", "finding": "Bootstrap passes two host References ($0 rpc, $1 log) into evalClosure; guest code only sees external_* closures over them. Arguments and results cross as JSON strings, and rpc uses apply with result.promise so calls overlap.", "evidence": IVM + "#L208-L248"},
        {"topic": "Isolation boundary", "finding": "New ivm.Isolate with memoryLimit per run, disposed in finally. Two timeout layers: the eval timeout stops sync loops, a host timer disposes the isolate while it awaits.", "evidence": IVM + "#L184-L194; " + IVM + "#L275-L292"},
        {"topic": "Deployment", "finding": "The constructor throws unless Node runs with --no-node-snapshot, because isolate creation otherwise crashes the process. TypeScript is stripped on the host with esbuild, a native binary.", "evidence": IVM + "#L48-L58; " + IVM + "#L131"},
    ] + SHARED_NOTES,
    "surprises": [
        "One of ten default P7 runs ended with the host process segfaulting (exit 139) right after Mastra returned the memory-limit error; the other nine continued normally.",
        "error.line is in the result type but never filled.",
    ],
}

# ---------------- LocalSandbox ----------------
i = "mastra-codemode-localsandbox"
results[i] = {
    "impl": i,
    "name": "Mastra Code Mode, default stdio transport on LocalSandbox",
    **common,
    "pinned": f"@mastra/core 1.85.0; source read at {SHA}",
    "engine": "A child `node --experimental-strip-types` process per run (host Node 24.22.1), spawned through LocalSandbox; no isolation unless `isolation` is set",
    "how_run": "createCodeMode({ tools: { lookup }, sandbox: new LocalSandbox() }).tool.execute({ code }, {}), the docs quickstart setup",
    "probes": {
        "P1": P("works", "works (42, 1 call)", "printed 42, 1 host call, 372 ms", ev(i, "P1")),
        "P2": P("works", "works (200,000 chars, no cap)", "full 200,000-char log line, no marker; result only with `return`", ev(i, "P2")),
        "P3": P("works", "works (example.com 200)", "fetch returned status 200, 577 bytes", ev(i, "P3")),
        "P4": P("works", "works (/etc/hosts read)", "await import('fs') and process.getBuiltinModule('fs') both read /etc/hosts; require is undefined only because the program is an ES module", ev(i, "P4")),
        "P5": P("blocked", "blocked (env scrubbed to PATH)", "process.env.PROBE_SECRET undefined; child env keys were PATH, PWD, SHLVL, _, __CF_USER_TEXT_ENCODING. Files the user can read stay readable (P4)", ev(i, "P5")),
        "P6": P("limited", "limited (30 s)", "TimeoutError after 30,062 ms; process tree killed", ev(i, "P6")),
        "P7": P("no-limit-within-120s", "no cap (4 GB harness kill)", "No Mastra memory limit. Run 1: the child node died on its own V8 heap limit after 25.9 s at 3.5 GB tree RSS ('Program exited without returning a result'); run 2 passed 4 GB host RSS at 16.4 s and the harness killed it", ev(i, "P7") + "; " + ev(i, "P7-run1-nosurvival")),
        "P8": P("works", "fresh", "second execution printed gone (new process)", ev(i, "P8")),
        "P9": P("works", "parallel (205 ms)", "in-code 205 ms, 5 host calls", ev(i, "P9")),
        "P10": P("works", "message only (no line)", "{message: 'probe-boom', name: 'Error'}; no stack or line", ev(i, "P10")),
        "P11": P("works", "97 ms median", "median 97 ms, p90 187 ms (one node process per run); first execution 376 ms; setup 133 ms", ev(i, "P11")),
        "P12": P("escaped", "escaped (child_process exec)", "Function('return process')() reached process; child_process.execSync printed 'PWNED' and the host user name. The two spec one-liners fail only because `this` is undefined in an ES module", ev(i, "P12")),
    },
    "hardened": {
        "config": "new LocalSandbox({ isolation: 'seatbelt', nativeSandbox: { allowNetwork: false, readOnly: true } }) and createCodeMode timeout: 5000; options at " + LOCAL + "#L87-L134 and https://mastra.ai/docs/sandbox/overview",
        "probes": {
            "P3": P("blocked", "blocked (seatbelt)", "TypeError: fetch failed (seatbelt denies network*)", ev(i, "hardened-P3")),
            "P4": P("works", "works (/etc/hosts read)", "seatbelt profile allows every file read; /etc/hosts read as in default", ev(i, "hardened-P4")),
            "P5": P("blocked", "blocked (env scrubbed to PATH)", "same as default", ev(i, "hardened-P5")),
            "P6": P("limited", "limited (5 s)", "TimeoutError after 5,118 ms", ev(i, "hardened-P6")),
            "P7": P("limited", "limited (5 s timeout, no mem cap)", "stopped only by the 5 s timeout at 2.7 to 2.8 GB tree RSS; host made a tool call afterwards", ev(i, "hardened-P7") + "; " + ev(i, "hardened-P7-run1-nosurvival")),
            "P9": P("works", "parallel (205 ms)", "5 host calls in parallel", ev(i, "hardened-P9")),
            "P12": P("escaped", "escaped (child_process exec)", "execSync still printed PWNED: seatbelt allows process-exec", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s, then the process tree is killed", "memory": "none from Mastra; the child node's own V8 heap limit (about 4.2 GB here)", "output": "no cap", "tool_calls": "no cap"},
    "source_notes": [
        {"topic": "Isolation boundary", "finding": "The stdio transport writes the program to a temp .ts file and spawns `node --experimental-strip-types` through the sandbox. With LocalSandbox the isolation default is 'none', and the docs say this runs 'as a host node process with host privileges'.", "evidence": CORE + "transport.ts#L29-L55; " + LOCAL + "#L120-L129"},
        {"topic": "Env", "finding": "LocalSandbox passes only PATH plus explicitly configured env to commands, so host secrets in env do not reach the program by default.", "evidence": LOCAL + "#L92-L109; " + LOCAL + "#L682-L688"},
        {"topic": "Seatbelt profile", "finding": "The generated macOS profile allows all file reads, allows process-exec and fork, limits writes to the workspace and temp dirs, and denies network unless allowNetwork.", "evidence": SEAT + "#L103-L108; " + SEAT + "#L148-L150; " + SEAT + "#L186-L192"},
        {"topic": "Bridge", "finding": "Newline-delimited JSON frames on stdout with a NUL-delimited prefix; the host answers rpc frames on the child's stdin, matched by id so Promise.all works.", "evidence": CORE + "runner.ts#L98-L138"},
    ] + SHARED_NOTES,
    "surprises": [
        "The quickstart on the docs page uses `new LocalSandbox()`, which runs model code as a full host Node process: it read /etc/hosts, reached example.com and ran a shell command.",
        "Even with seatbelt isolation the program reads any file the user can read and can exec binaries; only network and writes are restricted.",
        "Env is scrubbed to PATH by default, which is stricter than most host-process runners.",
    ],
}

# ---------------- E2B ----------------
i = "mastra-codemode-e2b"
blocked = {f"P{n}": P("blocked-needs-credentials", "blocked-needs-credentials", "E2B needs an account and API key (apiKey or E2B_API_KEY); not run", "workspaces/e2b/src/sandbox/index.ts:159-160 at " + SHA) for n in range(1, 13)}
results[i] = {
    "impl": i,
    "name": "Mastra Code Mode, E2B transport",
    **common,
    "source": common["source"] + "; npm @mastra/e2b 0.18.0",
    "pinned": f"@mastra/e2b 0.18.0 source at {SHA} (not installed or run)",
    "engine": "node inside an E2B cloud micro-VM",
    "how_run": "not run: createCodeMode({ tools, sandbox: new E2BSandbox() }, new E2BCodeModeTransport()) needs E2B credentials",
    "probes": blocked,
    "hardened": None,
    "defaults": {"time": "30 s Code Mode default; E2B sandbox timeout 300 s (docs)", "memory": "VM size of the E2B template (not checked)", "output": "no cap in Code Mode", "tool_calls": "no cap", "note": "hardened is null: not run for lack of credentials"},
    "source_notes": [
        {"topic": "Bridge", "finding": "Same stdio frame protocol as the default transport, but the runner and program are written into the VM with the E2B files API and run with plain `node`; TypeScript is stripped on the host with esbuild.", "evidence": E2B + "#L1-L19; " + E2B + "#L76; " + E2B + "#L115-L116"},
        {"topic": "Credentials", "finding": "Tools still execute on the host (same dispatcher as other transports), so tool credentials never enter the VM; the E2B API key is read from the constructor or E2B_API_KEY.", "evidence": CORE + "code-mode.ts#L102-L119; " + GH + "workspaces/e2b/src/sandbox/index.ts#L159-L160"},
    ] + SHARED_NOTES,
    "surprises": [],
}

out_dir = ROOT / "research/probes/results"
for impl, data in results.items():
    (out_dir / f"{impl}.json").write_text(json.dumps(data, indent=2) + "\n")
    print("wrote", impl)
