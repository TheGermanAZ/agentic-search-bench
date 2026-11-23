"""Writes research/probes/results/pi-codemode.json. Outcomes and details were written by hand from out/*.txt."""
import json
import pathlib

SHA = "fb248c7fca2539318f18ceb6534258048cb579c1"
GH = f"https://github.com/earendil-works/pi/blob/{SHA}/packages"
O = "research/probes/pi-codemode/out"


def p(outcome, detail, evidence, display):
    return {"outcome": outcome, "detail": detail, "evidence": evidence, "display": display}


probes = {
    "P1": p("works", "printed 42, 1 host call, 251 ms. Tool reached as tools.lookup({id: 21}).", f"{O}/P1.txt", "works (42, 1 call)"),
    "P2": p("works", "All 200,000 printed chars came back as one console text item, no truncation, no marker. The literal spec form (bare last expression \"RETURNED\") returns no value because code is an async function body; `return \"RETURNED\"` returns it alongside the output. The package caps output at MAX_OUTPUT_CHARS (16 Mi chars) by failing the script with a RangeError. Pi's coding agent, not the package, truncates to 10,000 tokens (40,000 chars) head+tail with a 'Warning: truncated output' marker and spills the rest to a temp file (source only, not probed).", f"{O}/P2.txt", "works (200,000 chars, 16 Mi cap)"),
    "P3": p("not-defined", "ReferenceError: fetch is not defined. typeof fetch/XMLHttpRequest/WebSocket all \"undefined\". No request left the host.", f"{O}/P3.txt", "not-defined"),
    "P4": p("not-defined", "require -> ReferenceError: require is not defined; import(\"fs\") -> ReferenceError: could not load module 'fs'; Deno -> ReferenceError: Deno is not defined.", f"{O}/P4.txt", "not-defined"),
    "P5": p("not-defined", "ReferenceError: process is not defined with PROBE_SECRET=s3cr3t set on the host. The global list holds only ECMAScript built-ins plus store, load, tools, ALL_TOOLS, console, text, image, exit, performance, btoa/atob, DOMException.", f"{O}/P5.txt", "not-defined"),
    "P6": p("no-limit-within-120s", "Package default timeoutMs is 300,000 ms, so the harness killed it at 120 s. A separate uncapped run ended at 300,006 ms with kind \"timeout\": \"Execution timed out after 300000 ms\". Pi's coding agent passes timeoutMs Infinity unless the model's own `// @options` line sets timeout_ms; that config also ran to the 120 s kill (agent-P6.txt).", f"{O}/P6.txt, {O}/P6-uncapped-300s.txt, {O}/agent-P6.txt", "no-limit-within-120s (300 s default)"),
    "P7": p("limited", "No memory cap by default (memoryLimitBytes undefined, wasm32's 4 GiB address space only). The VM failed with InternalError: out of memory inside the script after 19.8 s at 3.49 GB peak process RSS (an earlier run stopped at 1.87 GB after 17.7 s). Host survived: the next execution returned \"alive\". Pi's coding agent sets 256 MiB: out of memory after 0.9 s, 338 MB peak RSS (agent-P7.txt).", f"{O}/P7.txt, {O}/agent-P7.txt", "limited (wasm32 4 GiB, 3.5 GB RSS)"),
    "P8": p("works", "fresh: second execution printed gone. A new worker and QuickJS VM per execute(). Opt-in persistence only through store()/load(), which the host must pass back in.", f"{O}/P8.txt", "fresh"),
    "P9": p("works", "parallel: 209 ms for 5 x 200 ms lookups inside the script, 5 host calls. Tool calls are async messages to the host thread.", f"{O}/P9.txt", "parallel (209 ms)"),
    "P10": p("works", "result.ok false, error {kind: \"script\", name: \"Error\", message: \"probe-boom\", stack: \"Error: probe-boom\\n    at <anonymous> (codemode.js:1:39)\"}. Multi-line case reports codemode.js:3:11, the exact user line.", f"{O}/P10.txt", "works (message + exact line)"),
    "P11": p("works", "median 25.4 ms, p90 26.5 ms per fresh execution (new worker thread + QuickJS instance). Two reruns under load average 39 to 42 gave medians 34.1 and 34.4 ms. One-time setup including wasm compile: 52 to 73 ms for the first execution.", f"{O}/P11.txt, {O}/P11-run2.txt, {O}/P11-run3.txt", "works (25 ms median)"),
    "P12": p("blocked", "this.constructor.constructor(\"return process\")() -> ReferenceError: process is not defined (QuickJS realm). (function(){return this})().process -> undefined. Function(...) sees process/require/WebAssembly/__HOST_CANARY all undefined. tools.lookup.constructor.constructor(\"return typeof process\")() -> \"undefined\": host functions are wrapped inside the VM, so their constructors are VM constructors.", f"{O}/P12.txt", "blocked"),
}

hardened_cfg = "new CodemodeSandbox({ tools, timeoutMs: 30_000, memoryLimitBytes: 32 * 1024 * 1024 }). Both are public options (packages/codemode/README.md, types.d.ts CodemodeSandboxBaseOptions). 30,000 ms is the timeout_ms in the README's options-line example; 32 MiB is the per-VM memory default the README documents for the Cloudflare sandbox. The package exposes no network or filesystem option because the VM has neither."
hardened = {
    "config": f"{hardened_cfg} {GH}/codemode/README.md",
    "probes": {
        "P3": p("not-defined", "ReferenceError: fetch is not defined.", f"{O}/hardened-P3.txt", "not-defined"),
        "P4": p("not-defined", "require, import(\"fs\") and Deno all fail as in default.", f"{O}/hardened-P4.txt", "not-defined"),
        "P5": p("not-defined", "ReferenceError: process is not defined.", f"{O}/hardened-P5.txt", "not-defined"),
        "P6": p("limited", "kind \"timeout\": \"Execution timed out after 30000 ms\" at 30.1 s wall. Async variants `while (true) await null` and `await null; while (true) {}` are also stopped at 30.0 s (hardened-P6b.txt).", f"{O}/hardened-P6.txt, {O}/hardened-P6b.txt", "limited (30 s)"),
        "P7": p("limited", "InternalError: out of memory inside the script after 0.24 s wall, 129 MB peak process RSS. Next execution returned \"alive\".", f"{O}/hardened-P7.txt", "limited (32 MiB)"),
        "P9": p("works", "parallel: 204 ms, 5 host calls.", f"{O}/hardened-P9.txt", "parallel (204 ms)"),
        "P12": p("blocked", "All five attempts see no process, as in default.", f"{O}/hardened-P12.txt", "blocked"),
    },
}

result = {
    "impl": "pi-codemode",
    "name": "Pi coding agent codemode (@earendil-works/pi-codemode)",
    "source": "https://github.com/earendil-works/pi (packages/codemode); npm @earendil-works/pi-codemode",
    "pinned": f"{SHA} (packages/codemode 1.6.0, CHANGELOG has no unreleased changes after 1.6.0); probed the npm build @earendil-works/pi-codemode 1.6.0 with quickjs-wasi 3.6.2",
    "language": "JS",
    "engine": "QuickJS compiled to WASI wasm (quickjs-wasi 3.6.2), a fresh wasm instance in a fresh Node worker_thread per execute()",
    "how_run": "new CodemodeSandbox({ tools: [lookup], ...options }).execute(code), the same class and method Pi's coding agent calls (packages/coding-agent/src/extensions/codemode/execute.ts:584-605).",
    "probes": probes,
    "hardened": hardened,
    "defaults": {
        "time": "300,000 ms overall deadline including tool time (DEFAULT_TIMEOUT_MS, packages/codemode/src/runtime/execution.ts:49). Pi's coding agent overrides it to Infinity unless the script's own `// @options` line sets timeout_ms (coding-agent execute.ts:555, 592).",
        "memory": "none beyond wasm32's 4 GiB (memoryLimitBytes undefined, execution.ts:471; types.d.ts doc). Pi's coding agent sets 256 MiB (coding-agent execute.ts:56, 593).",
        "output": "16 Mi chars and 100,000 items; past either the script fails with a RangeError (prelude-source.ts:42-43, 348-350). Pi's coding agent truncates to 10,000 tokens with a marker (execute.ts:306, 449-470).",
        "tool_calls": "no per-execution cap in the package. Pi's coding agent limits workers process-wide to 2 (PI_CODEMODE_MAX_WORKERS, execute.ts:58-64) and model calls in flight to 4 (execute.ts:50).",
    },
    "source_notes": [
        {"topic": "API shape", "finding": "Each CodemodeTool becomes tools.<jsName> on a frozen null-prototype object built by the in-VM prelude; ALL_TOOLS lists {name, description}. renderDeclarations() turns JSON Schema inputSchema/outputSchema into TypeScript declarations for the model-facing description; schemas only shape the text, arguments are not validated.", "evidence": f"{GH}/codemode/src/runtime/prelude-source.ts#L215-L227 and {GH}/codemode/src/declarations.ts#L45"},
        {"topic": "Discovery", "finding": "Pi's coding agent inlines declarations up to an inline budget (3,000 estimated tokens by default) and exposes searchTools(query) (BM25), describeTool(name), describeNamespace(name) and ALL_TOOLS as in-VM globals for the rest, so it scales past 100 tools without every schema in the prompt.", "evidence": f"{GH}/coding-agent/src/extensions/codemode/execute.ts#L664-L720, {GH}/coding-agent/src/extensions/codemode/tool.ts#L133-L142 and #L252, {GH}/coding-agent/src/core/settings-defaults.ts#L59"},
        {"topic": "Bridge", "finding": "One `bridge` host function registered in the VM; the worker relays each tool call to the host thread with postMessage and the host posts the JSON result back. Calls are promises, so Promise.all overlaps them (P9 209 ms).", "evidence": f"{GH}/codemode/src/runtime/vm.ts#L254 and {GH}/codemode/src/runtime/host.ts#L33-L73"},
        {"topic": "Isolation boundary", "finding": "QuickJS in its own wasm instance and linear memory, inside a worker_thread. The wasm imports are a WASI shim (clock, random, discarded stdout/stderr) plus the bridge, so the only capability is the injected tools. The prelude freezes built-ins and makes built-in globals read-only. Code matches the README claim; P3, P4, P5 and P12 confirm. The worker has no Node resourceLimits; the memory cap is QuickJS's own memoryLimit.", "evidence": f"{GH}/codemode/src/runtime/vm.ts#L110-L180, {GH}/codemode/src/runtime/worker.ts#L1-L39, {GH}/codemode/src/runtime/prelude-source.ts#L30"},
        {"topic": "Output channel", "finding": "result.output holds text items from text() and console.* (marked console: true) plus image items; the return value is result.value. The package keeps everything up to 16 Mi chars. Pi's coding agent appends the return value as text, then truncates combined text to 10,000 tokens keeping head and tail, with 'Warning: truncated output (original token count: N)' and '[Full output: <path>]'.", "evidence": f"{GH}/codemode/src/runtime/prelude-source.ts#L42-L43 and {GH}/coding-agent/src/extensions/codemode/execute.ts#L449-L470"},
        {"topic": "Limits", "finding": "Time: host-owned deadline, default 300 s; on expiry the host sets a SharedArrayBuffer interrupt flag polled by QuickJS and between promise-job batches, then terminate()s the worker, so async spin loops are also stopped (hardened-P6b). Memory: QuickJS memoryLimit only when memoryLimitBytes is set.", "evidence": f"{GH}/codemode/src/runtime/execution.ts#L49 and #L214-L217, {GH}/codemode/src/runtime/host.ts#L59-L66, {GH}/codemode/src/runtime/vm.ts#L172-L176 and #L238-L247"},
        {"topic": "Limits in Pi's own wiring", "finding": "The coding agent passes memoryLimitBytes 256 MiB with a comment that without it 'a runaway script can grow to wasm32's 4 GiB and take the session down', but its deadline is sourceOptions.timeoutMs ?? Infinity, i.e. no time limit unless the model writes `// @options: {\"timeout_ms\": ...}`. Only the user's abort stops a spinning script.", "evidence": f"{GH}/coding-agent/src/extensions/codemode/execute.ts#L51-L56 and #L555-L593"},
        {"topic": "State", "finding": "Fresh worker and VM per execute(). store(key, value)/load(key) are explicit JSON persistence that the host passes in as options.store and receives back as result.storeWrites; the sandbox itself persists nothing.", "evidence": f"{GH}/codemode/README.md (Store section) and {GH}/codemode/src/runtime/prelude-source.ts#L306-L315"},
        {"topic": "Errors", "finding": "execute() never rejects for script failures; result.error has kind script/timeout/aborted/sandbox, name, message and stack with codemode.js:<line>. The wrapper shares line 1 with the script so line numbers are exact.", "evidence": f"{GH}/codemode/README.md (Results and Runtime notes) and {O}/P10.txt"},
        {"topic": "Credentials and other", "finding": "Tools run on the host thread; the VM sees only JSON results, so credentials stay host-side. A deterministic start() mode fixes time, randomness and result order for durable replay. Pi's coding agent routes nested calls through its tool hooks only when using runToolCall (README).", "evidence": f"{GH}/codemode/README.md (Deterministic runs, Using with pi-agent-core)"},
    ],
    "surprises": [
        "Pi's coding agent, the main consumer, runs codemode with no time limit by default: deadline = sourceOptions.timeoutMs ?? Infinity (coding-agent execute.ts:555). P6 under that config ran until the 120 s harness kill. The standalone package default is 300 s.",
        "The package default has no memory cap. P7 grew to 1.9 to 3.5 GB RSS before QuickJS reported out of memory at the wasm32 boundary; the host survived. Pi's coding agent fixes this with 256 MiB and says why in a comment.",
        "The literal P2 form (bare last expression) returns nothing: code is an async function body, so only `return` yields a value. The README says so.",
        "Measured startup was 25 to 34 ms per execution under load average 39 to 42 on a shared machine, against the README's 'about 20 ms'.",
    ],
}

root = pathlib.Path(__file__).resolve().parents[1]
(root / "results" / "pi-codemode.json").write_text(json.dumps(result, indent=2) + "\n")
print("wrote", root / "results" / "pi-codemode.json")
