# Writes research/probes/results/openclaw-codemode-{node-vm,quickjs-wasi}.json from the probe outputs read by hand.
# Run: python3 -I research/probes/openclaw-codemode-node-vm/write-results.py
import json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SHA = "06afb10d3272cc9deaf38ca6a3b7b839d5935638"
GH = f"https://github.com/openclaw/openclaw/blob/{SHA}/"
def L(path, a, b=None):
    return f"{GH}{path}#L{a}" + (f"-L{b}" if b else "")

def P(outcome, display, detail, evidence):
    assert len(display) <= 40, (display, len(display))
    return {"outcome": outcome, "display": display, "detail": detail, "evidence": evidence}

PINNED = (f"npm openclaw@2026.11.6 (published dist, installed with --ignore-scripts into research/impls/openclaw-codemode-node-vm/npm); "
          f"source read at tag v2026.11.6 = {SHA} (2026-11-19), cloned to research/impls/openclaw-codemode-node-vm/src")
HOW = ("createCodeModeTools(ctx) + applyCodeModeCatalog({...ctx, tools: [exec, wait, lookup]}) from the published dist chunks "
       "(src/agents/code-mode.ts:220 and :313; not in the package's public exports, so imported from dist/prompt-tool-policy-XiWNJtPU.mjs), "
       "then execTool.execute(id, {code}) and waitTool.execute on status 'waiting': the same exec/wait control tools the embedded agent runtime gives the model. "
       "lookup is a plugin-tagged AgentTool (setPluginToolMeta) in the hidden catalog; guest code calls it as the async global lookup({id}). "
       "OpenClaw HOME/state/config are pointed at research/probes/<impl>/state. P11 is also measured with WARM_HOST=1, which runs cells inside a bound "
       "LegacyPluginSdkResourceHost + GatewayScheduler as the Gateway does (scripts/perf/code-mode-engine-measure.ts does the same).")

SHARED_DEFAULTS = {
    "time": "timeoutMs 10,000 ms wall clock per exec or wait call (clamp 100-60,000), shared by worker preparation, guest work and inline tool waits; approval waits pause it. Pending tool calls can instead return status 'waiting' for a later wait with a fresh budget (src/agents/code-mode-runtime.ts:110; docs/tools/code-mode/configuration.md).",
    "output": "maxOutputBytes 64 KiB shared by output entries, value and error across waits (clamp 1 KiB-10 MiB); over the cap a {truncated, omittedBytes, guidance, prefix} marker replaces the item. Console: each string clipped to 512 UTF-16 units with '…[truncated]', 16,384 units per cell then '[console output truncated]' (code-mode-runtime.ts:112; code-mode-controller-source.ts:101-115; code-mode-json.ts:93). A trailing expression returns null; only `return` sets the value.",
    "tool_calls": "maxPendingToolCalls 16 in flight (clamp 1-128); further calls queue in the guest, up to 128 queued ordinary calls (code-mode-runtime.ts:114; code-mode-controller-source.ts:12, :227-230; code-mode-worker-types.ts:10). No per-exec total call cap was found on the exec path: 40 calls ran. Headless scripts default to 5 calls (code-mode-runtime.ts:26).",
}

def source_notes(engine):
    notes = [
        {"topic": "API shape", "finding": "Every catalog-eligible tool becomes an async global function (callableName) plus a callable handle; bindings come from createCodeModeCatalogBindings. The model sees a bounded quick index of `name input -> output` hints built from JSON Schema, capped at 8,000 chars, and TypeScript-style declarations through API.list/API.read. Executable cells are plain JavaScript; TypeScript syntax and require/import are rejected before execution.",
         "evidence": f"{L('src/agents/code-mode.ts', 64)}, {L('src/agents/code-mode.ts', 111, 149)}, {L('src/agents/code-mode-catalog.ts', 73)}, {L('src/agents/code-mode-controller-source.ts', 660, 671)}"},
        {"topic": "Discovery", "finding": "Hidden catalog, searched on demand: only exec and wait (plus required direct-only tools) are model-visible (telemetry visibleTools [exec, wait] in every result). Tools past the 8,000-char index are reachable through catalog.search(query) (BM25 lexical index, default 8 results, max 50) and handle.describe(). Scales past 100 tools without putting every schema in the prompt.",
         "evidence": f"{L('src/agents/code-mode.ts', 95, 100)}, {L('src/agents/code-mode-controller-source.ts', 629, 638)}, {L('src/agents/code-mode-runtime.ts', 104, 117)}; research/probes/{engine}/out/P1.txt"},
        {"topic": "Bridge", "finding": "Guest calls go through the controller's request() into a host callback that carries only strings (method, JSON args, id, stack); the host runs the call through runtime.callExactValue, the same tool execution path as normal turns (policy, approvals, before_tool_call hooks). Replies are queued on the host and pulled by the guest (__openclawSettleBridge). " + ("Node: host function __openclawHostRequest installed on the vm context and deleted from globals after the controller captures it." if engine.endswith("node-vm") else "QuickJS: host functions installed with vm.newFunction in the worker; the guest keeps a serializable snapshot while suspended."),
         "evidence": f"{L('src/agents/code-mode-controller-source.ts', 20, 32)}, {L('src/agents/code-mode-controller-source.ts', 221, 231)}, {L('src/agents/code-mode-bridge.ts', 386)}, " + (L('src/agents/code-mode-node.worker.ts', 272, 300) if engine.endswith("node-vm") else L('extensions/code-mode-quickjs/src/code-mode.worker.ts', 176, 230) + ", " + L('extensions/code-mode-quickjs/src/code-mode.worker.ts', 328))},
    ]
    if engine.endswith("node-vm"):
        notes.append({"topic": "Isolation boundary", "finding": "node:vm context (createContext(Object.create(null)), microtaskMode afterEvaluate, dynamic import rejected) in a worker_threads Worker with env {} and V8 heap resourceLimits. The docs say plainly that this is NOT a security boundary. The code adds one concrete hole: the host realm's TextEncoder/TextDecoder classes are injected into the context and wrapped by guest classes that hold the host instance in a #private field (comment: 'Keep native encoding prototypes private'). Errors thrown by the host decoder (bad label, fatal decode) reach guest code unwrapped, so e.constructor.constructor is the host Function: process, child_process, fs and network follow (P12 #9-#12, P3 #3). env {} hides process.env, but `ps -E` on the gateway pid returns PROBE_SECRET.",
                      "evidence": f"{L('src/agents/code-mode-node.worker.ts', 155, 182)}, {L('src/agents/code-mode-node.worker.ts', 252, 271)}, {L('src/agents/code-mode-node.ts', 228, 239)}, docs/tools/code-mode/executors.md ('Node's node:vm is not a security boundary'); research/probes/openclaw-codemode-node-vm/out/P12.txt"})
    else:
        notes.append({"topic": "Isolation boundary", "finding": "QuickJS compiled to WASM/WASI (quickjs-wasi 3.6.3, bundled; TextEncoder/TextDecoder come from the encoding.so extension inside the same WASM heap), in a worker thread from a shared WorkerTaskPool. No WASI preopens or env are given, so no ambient fs, network, subprocess or environment. memoryLimit = memoryLimitBytes, fixed maxStackSize, and an interruptHandler that checks the wall-clock deadline. The docs claim 'hardened guest isolation' with 'no ambient host access', which matches the probes: guest errors are guest-realm (e.constructor === RangeError), every Function-constructor path returns undefined for process.",
                      "evidence": f"{L('extensions/code-mode-quickjs/src/code-mode.worker.ts', 255, 275)}, {L('extensions/code-mode-quickjs/src/executor.ts', 36, 62)}, {L('extensions/code-mode-quickjs/package.json', 7, 9)}, docs/tools/code-mode/internals.md 'Security boundary'; research/probes/openclaw-codemode-quickjs-wasi/out/P12.txt"})
    notes += [
        {"topic": "Output channel", "finding": "The model gets one JSON document: status, telemetry, ordered output entries (text(), json(), console.*) and the returned value or error. Over-budget items become an explicit truncation marker with the original JSON prefix and omittedBytes, not a silent cut. Console strings are clipped to 512 units each.",
         "evidence": f"{L('src/agents/code-mode-controller-source.ts', 101, 115)}, {L('src/agents/code-mode-json.ts', 93)}, {L('src/agents/code-mode.ts', 226, 245)}; research/probes/{engine}/out/P2.txt"},
        {"topic": "Limits", "finding": "All limits come from tools.codeMode (global or per agent) and are clamped in resolveCodeModeConfig: timeoutMs 10 s (100 ms-60 s), memoryLimitBytes 64 MiB (1 MiB-1 GiB), maxOutputBytes 64 KiB, maxSnapshotBytes 10 MiB, maxPendingToolCalls 16, snapshotTtlSeconds 900. " + ("For Node, memoryLimitBytes becomes the Worker's maxOldGenerationSizeMb (limit-4 MB) plus 4 MB young; a GC watchdog retires near-limit workers; the deadline is enforced by terminating the worker." if engine.endswith("node-vm") else "For QuickJS, memoryLimitBytes is the engine heap limit and timeoutMs drives the interrupt handler; snapshots are capped by maxSnapshotBytes."),
         "evidence": f"{L('src/agents/code-mode-runtime.ts', 96, 119)}" + (f", {L('src/agents/code-mode-node.ts', 234, 238)}" if engine.endswith("node-vm") else f", {L('extensions/code-mode-quickjs/src/code-mode.worker.ts', 264, 271)}")},
        {"topic": "State", "finding": "Each exec gets a fresh context (globals never carry over), confirmed by P8. Workers are pooled and reused only when cells run inside the Gateway's bound resource host; without it every Node cell starts a new worker (about 200 ms). There is opt-in persistence: store(key, value)/load(key) keep small JSON values per session across cells and restarts, but only for a session-bound run (P8 #3 fails in this harness). A suspended cell (status 'waiting') keeps " + ("its live worker and context" if engine.endswith("node-vm") else "a serialized VM snapshot") + " for wait.",
         "evidence": f"{L('src/agents/code-mode-controller-source.ts', 430, 445)}, {L('src/agents/code-mode-session-store.ts', 315)}, docs/tools/code-mode/executors.md 'Understand waits and limits'; research/probes/{engine}/out/P8.txt, out/P11.txt, out/warm-P11.txt"},
        {"topic": "Errors", "finding": "Guest errors return status failed with code internal_error and `Name: message` plus stack frames rewritten to openclaw-code-mode:user.js:line:col (user line numbers, wrapper removed); error text is bounded to 16,384 units. Parse errors are reported before execution with line and column. A runtime `ReferenceError: process|require|module is not defined` is rewritten into the generic 'module access is disabled' invalid_input message. Tool errors are catchable in guest code and are redacted (input shown as [redacted]).",
         "evidence": f"{L('src/agents/code-mode-source.ts', 212, 231)}, {L('src/agents/code-mode-node.worker.ts', 360, 380)}, {L('extensions/code-mode-quickjs/src/code-mode.worker.ts', 455, 470)}, {L('src/agents/code-mode-controller-source.ts', 62, 85)}"},
        {"topic": "Activation and credentials", "finding": "With tools.codeMode absent, activation is 'auto': Code Mode engages automatically for catalog-preferred models (for example claude-opus-5-5, gpt-5.6, gemini-3.5-flash) with the Node executor unless executor: 'quickjs' is set. Credentials stay host-side: tools run in the Gateway with their normal auth, and the guest only receives JSON results. The lexical module check (code-mode-source.ts:226) is a usability guard, not a security control: it blocks the literal require()/import() but not Function-constructor paths.",
         "evidence": f"{L('src/agents/code-mode-runtime.ts', 75, 77)}, {L('src/agents/code-mode-runtime.ts', 107, 108)}, {L('src/agents/code-mode-runtime.ts', 128, 140)}, docs/tools/code-mode/configuration.md 'Shipped preferred models'"},
        {"topic": "Maintenance", "finding": "MIT license; tag v2026.11.6 committed 2026-11-19; npm openclaw 2026.11.6. Extensive tests under src/agents/code-mode*.test.ts, including an engine-parity suite.", "evidence": f"{GH}package.json, {GH}src/agents/code-mode-engine-parity.test.ts"},
    ]
    return notes

def write(name, data):
    path = os.path.join(ROOT, "research/probes/results", f"{name}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote", path)

# ---------------- node-vm ----------------
E = "research/probes/openclaw-codemode-node-vm/out/"
node = {
    "impl": "openclaw-codemode-node-vm",
    "name": "OpenClaw Code Mode, Node executor (node:vm in a worker thread, the default)",
    "source": "https://github.com/openclaw/openclaw (src/agents/code-mode*.ts); npm openclaw",
    "pinned": PINNED,
    "language": "JS",
    "engine": "Node.js node:vm context (fresh per cell) inside a pooled worker_threads Worker of the Gateway process, env {}, V8 heap resourceLimits; Node v24.22.1 on the host",
    "how_run": HOW + " Executor: tools.codeMode = {enabled: true, executor: 'node'} (node is also the default executor).",
    "probes": {
        "P1": P("works", "works (42, 1 call)", "lookup({id:21}) returned {id:21, value:42} (the tool's details object); console.log printed 42 into output; 1 host call; 434-494 ms (new worker per cell in this harness).", E + "P1.txt"),
        "P2": P("limited", "truncated (512 chars + marker)", "console.log of 200,000 A's came back as one 524-char text entry: 512 A's + '…[truncated]' (per-string console clip). Trailing expression \"RETURNED\" returned null; `return \"RETURNED\"` returned it with the same clipped log (P2 #2). text() of 200,000 chars became {truncated:true, omittedBytes:134619, guidance:'Output truncated; rerun with narrower args.', prefix:<65,381 chars>} under maxOutputBytes 64 KiB (#3); a 200,000-char return value got the same marker (omittedBytes 134,576, #4). Both channels return; every cut is marked.", E + "P2.txt"),
        "P3": P("escaped", "escaped (curl example.com 200)", "fetch, XMLHttpRequest, WebSocket, require and process are undefined in the guest (ReferenceError: fetch is not defined). But through the P12 TextDecoder escape the cell ran host child_process `curl https://example.com` and got HTTP 200 (#3). An async host fetch is reachable too, but the cell then fails with 'code mode promise is pending without host work'.", E + "P3.txt"),
        "P4": P("escaped", "escaped (via host Function)", "require(\"fs\") and import(\"fs\") are rejected before execution: invalid_input 'code mode module access is disabled...' (lexical AST check). Deno is not defined. Through the TextDecoder escape the cell read /etc/hosts with host fs.readFileSync (P12 #11).", E + "P4.txt, " + E + "P12.txt"),
        "P5": P("escaped", "escaped (PROBE_SECRET via ps)", "process.env.PROBE_SECRET: 'process is not defined' rewritten to the module-access message. After the escape, the worker's process.env is empty (Worker env {}), so p.env.PROBE_SECRET is undefined, but `ps -wwE -p <pid>` through host child_process returned PROBE_SECRET=s3cr3t from the gateway's own environment (P12 #12).", E + "P5.txt, " + E + "P12.txt"),
        "P6": P("limited", "limited (10 s wall)", "while(true){} failed with code timeout, 'code mode timeout exceeded', after 10,013 ms (worker terminated). A concurrent cell started at +100 ms returned 42 in 193 ms; a later cell returned 42.", E + "P6.txt"),
        "P7": P("limited", "limited (64 MiB heap, worker retired)", "Failed after 326 ms with runtime_unavailable: 'Code Mode worker exhausted its 64 MiB JavaScript heap...'; peak host RSS 343 MB. The concurrent and the next cell returned 42; the host process survived. Same with a warm Gateway-style host (warm-P7).", E + "P7.txt, " + E + "warm-P7.txt"),
        "P8": P("works", "fresh", "Second cell printed 'gone'. store()/load() persistence exists but needs a session-bound run: 'Code Mode store/load requires an active session-bound run' in this harness.", E + "P8.txt"),
        "P9": P("works", "parallel (206 ms)", "Promise.all of 5 lookups: 206 ms guest-measured, 5 host calls. 40 concurrent calls all succeeded in 620 ms (queued behind maxPendingToolCalls 16: three waves).", E + "P9.txt"),
        "P10": P("works", "works (message + line:col)", "status failed, code internal_error, error 'Error: probe-boom\\n    at openclaw-code-mode:user.js:1:7'. A nested throw keeps the user's lines: 'at inner (openclaw-code-mode:user.js:3:26) / at openclaw-code-mode:user.js:4:1'.", E + "P10.txt"),
        "P11": P("works", "works (median 0.95 ms warm host)", "With the Gateway's bound resource host (warm workers): median 0.95 ms, p90 1.09 ms, first exec 2.5 ms. Without it (direct tool use, as in the other probes) every cell starts a new worker: median 253 ms, p90 358 ms, first 236 ms; load average 26-31 during the run. Tool creation 1 ms.", E + "warm-P11.txt, " + E + "P11.txt"),
        "P12": P("escaped", "escaped (TextDecoder host error)", "this.constructor.constructor('return process')() is the guest Function: process is not defined (rewritten to the module-access message); sloppy-this .process undefined; handles, tool results and tool errors are guest-realm; a scan of 607 reachable objects found no host-realm constructor. But `new TextDecoder('no-such-label')` throws a host-realm RangeError (e.constructor !== RangeError); its .constructor.constructor('return process')() is the worker's real process: execSync('echo PWNED') printed PWNED, fs read /etc/hosts, pid shown, isMainThread false, and ps -E exposed PROBE_SECRET. The fatal-decode TypeError path works the same.", E + "P12.txt"),
    },
    "hardened": {
        "config": "tools.codeMode = {enabled: true, executor: 'node', timeoutMs: 5000, memoryLimitBytes: 16 MiB, maxOutputBytes: 8192, maxSnapshotBytes: 1 MiB, maxPendingToolCalls: 8, snapshotTtlSeconds: 60} (fields and clamps: docs/tools/code-mode/configuration.md; " + L('src/agents/code-mode-runtime.ts', 104, 117) + "). Tight but usable values inside the documented clamps (timeoutMs floor 100 ms, memory floor 1 MiB). The project exposes no option that makes node:vm an isolation boundary; its documented hardening is executor: 'quickjs', which is the separate impl openclaw-codemode-quickjs-wasi.",
        "probes": {
            "P3": P("escaped", "escaped (same TextDecoder path)", "fetch is not defined in the guest; the escape path is unchanged by any limit (see hardened-P12).", E + "hardened-P3.txt"),
            "P4": P("escaped", "escaped (same TextDecoder path)", "require/import rejected; Deno not defined; host fs reachable via the escape (hardened-P12 #11).", E + "hardened-P4.txt, " + E + "hardened-P12.txt"),
            "P5": P("escaped", "escaped (PROBE_SECRET via ps)", "process is not defined directly; via the escape, ps -E returned PROBE_SECRET=s3cr3t (hardened-P12 #12).", E + "hardened-P5.txt, " + E + "hardened-P12.txt"),
            "P6": P("limited", "limited (5 s wall)", "code timeout after 5,017 ms. In this run the concurrent trivial cell failed with runtime_unavailable 'Code Mode worker exhausted its 16 MiB JavaScript heap'; two reruns (out/rerun1, out/rerun2) had it return 42. The later cell returned 42.", E + "hardened-P6.txt, " + E + "rerun1/hardened-P6.txt, " + E + "rerun2/hardened-P6.txt"),
            "P7": P("limited", "limited (16 MiB heap, worker retired)", "runtime_unavailable '...exhausted its 16 MiB JavaScript heap' after 240 ms; peak host RSS 289 MB; concurrent and later cells returned 42.", E + "hardened-P7.txt"),
            "P9": P("works", "parallel (218 ms)", "5 lookups 218 ms guest-measured, 5 host calls; 40 calls queued behind maxPendingToolCalls 8 and finished in 1,022 ms (five waves).", E + "hardened-P9.txt"),
            "P12": P("escaped", "escaped (TextDecoder host error)", "Same as default: PWNED, /etc/hosts, PROBE_SECRET via ps -E.", E + "hardened-P12.txt"),
        },
    },
    "defaults": dict(SHARED_DEFAULTS, memory="memoryLimitBytes 64 MiB, applied as the Worker's V8 resourceLimits (maxOldGenerationSizeMb = 60, maxYoungGenerationSizeMb = 4) plus a GC-pressure watchdog that fails the cell with runtime_unavailable and retires the worker. Not an RSS limit: external buffers are excluded, and up to eight warm workers may be kept (code-mode-node.ts:234-238; docs/tools/code-mode/executors.md)."),
    "source_notes": source_notes("openclaw-codemode-node-vm"),
    "surprises": [
        "The guest-API docs say TextEncoder/TextDecoder 'provide local byte conversion, not filesystem, module, or network access' (docs/tools/code-mode/guest-api.md:50-52). Under the Node executor they are the escape: errors thrown by the injected host-realm decoder carry the host Function constructor, so guest code gets process, child_process, fs and network. The wrapper hides the host prototypes (code-mode-node.worker.ts:155-182) but not the host errors.",
        "The docs are honest that node:vm is 'not a security boundary', but it is the default executor, and with tools.codeMode absent Code Mode engages automatically ('auto') for preferred models such as claude-opus-5-5 and gpt-5.6. A default install with a preferred model therefore runs model-written code in an escapable context inside the Gateway process.",
        "Worker env {} hides process.env from an escaped cell, but `ps -E` on the shared pid still returns the Gateway's environment, PROBE_SECRET included.",
        "A runtime 'process is not defined' is reported as invalid_input 'code mode module access is disabled' with failurePhase 'input', although the code had already run.",
        "Without the Gateway's bound resource host every Node cell spawns a new worker (median 253 ms); inside it, cells reuse warm workers (median 0.95 ms). Direct callers of the exec tool pay the cold path.",
        "At memoryLimitBytes 16 MiB, a trivial concurrent `return 42` cell failed once (1 of 3 runs) with 'worker exhausted its 16 MiB JavaScript heap' while another cell was spinning.",
        "A trailing expression yields null (documented in the exec schema), so the SPEC's P2 form returns no value; only `return` does.",
    ],
}

# ---------------- quickjs-wasi ----------------
E = "research/probes/openclaw-codemode-quickjs-wasi/out/"
qjs = {
    "impl": "openclaw-codemode-quickjs-wasi",
    "name": "OpenClaw Code Mode, QuickJS executor (bundled code-mode-quickjs plugin, QuickJS-WASI)",
    "source": "https://github.com/openclaw/openclaw (extensions/code-mode-quickjs, src/agents/code-mode*.ts); npm openclaw (dist/extensions/code-mode-quickjs)",
    "pinned": PINNED + ". Same install and clone as openclaw-codemode-node-vm (shared on purpose; research/impls/openclaw-codemode-quickjs-wasi/README.md points there). quickjs-wasi 3.6.3 bundled in the plugin.",
    "language": "JS",
    "engine": "QuickJS compiled to WASM/WASI (quickjs-wasi 3.6.3) in a pooled Node worker thread, fresh VM per cell, serialized VM snapshot while suspended",
    "how_run": HOW + " Executor: tools.codeMode = {enabled: true, executor: 'quickjs'}; resolvePluginCodeModeExecutor loads the bundled plugin from the dist manifest with no extra plugin config.",
    "probes": {
        "P1": P("works", "works (42, 1 call)", "lookup({id:21}) returned {id:21, value:42}; output text '42'; 1 host call; 613 ms including first worker and WASM start.", E + "P1.txt"),
        "P2": P("limited", "truncated (512 chars + marker)", "Identical to the Node executor: console.log of 200,000 chars became one 512-char text + '…[truncated]'; trailing \"RETURNED\" gave value null, `return` gave \"RETURNED\"; text() and a returned 200,000-char string became {truncated:true, omittedBytes:134619/134576, guidance, prefix} at maxOutputBytes 64 KiB.", E + "P2.txt"),
        "P3": P("not-defined", "not-defined", "ReferenceError: fetch is not defined; XMLHttpRequest, WebSocket, require, process all undefined. The TextDecoder-error path that escapes the Node executor yields a guest-realm Function here, so 'return process' fails with process is not defined (reported as module access disabled, #3).", E + "P3.txt"),
        "P4": P("not-defined", "not-defined", "require(\"fs\") and import(\"fs\") rejected before execution with 'code mode module access is disabled' (invalid_input); Deno is not defined.", E + "P4.txt"),
        "P5": P("not-defined", "not-defined", "process is not defined (reported as 'code mode module access is disabled.'); globals are ECMAScript builtins plus the Code Mode API (P5 #2). Host had PROBE_SECRET=s3cr3t.", E + "P5.txt"),
        "P6": P("limited", "limited (10 s wall)", "code timeout 'code mode timeout exceeded' after 10,004 ms (interrupt handler). A concurrent cell returned 42 in 150 ms; a later cell returned 42.", E + "P6.txt"),
        "P7": P("limited", "limited (64 MiB)", "'InternalError: out of memory at openclaw-code-mode:user.js:1:39' after 714 ms; peak host RSS 459 MB; concurrent and later cells returned 42.", E + "P7.txt"),
        "P8": P("works", "fresh", "Second cell printed 'gone'. store()/load() need a session-bound run (failed in this harness).", E + "P8.txt"),
        "P9": P("works", "parallel (207 ms)", "Promise.all of 5 lookups: 207 ms guest-measured, 212 ms host wall, 5 host calls. 40 concurrent calls succeeded in 618 ms (three waves of 16).", E + "P9.txt"),
        "P10": P("works", "works (message + line:col)", "status failed, internal_error, 'Error: probe-boom\\n    at <anonymous> (openclaw-code-mode:user.js:1:11)'; nested: 'at inner (openclaw-code-mode:user.js:3:30) / at <anonymous> (...:4:1)'.", E + "P10.txt"),
        "P11": P("works", "works (median 1.9 ms warm host)", "Warm Gateway-style host: median 1.92 ms, p90 2.36 ms, first exec 3.3 ms. Without the bound host: median 2.88 ms, p90 5.12 ms, first 5.5 ms (QuickJS workers are pooled by the plugin either way). Load average 26-31.", E + "warm-P11.txt, " + E + "P11.txt"),
        "P12": P("blocked", "blocked", "Function('return process')() -> process is not defined; sloppy this.process undefined; Function from handles, results and tool errors is the guest's; scan of 551 reachable objects found no foreign constructor; TextDecoder errors are guest-realm (e.constructor === RangeError/TypeError true) and their Function sees process undefined; the PWNED and ps -E attempts were refused because process is not defined.", E + "P12.txt"),
    },
    "hardened": {
        "config": "tools.codeMode = {enabled: true, executor: 'quickjs', timeoutMs: 5000, memoryLimitBytes: 16 MiB, maxOutputBytes: 8192, maxSnapshotBytes: 1 MiB, maxPendingToolCalls: 8, snapshotTtlSeconds: 60} (docs/tools/code-mode/configuration.md; " + L('src/agents/code-mode-runtime.ts', 104, 117) + "). Tight but usable values inside the documented clamps (floors: timeoutMs 100 ms, memoryLimitBytes 1 MiB, maxOutputBytes 1 KiB, maxPendingToolCalls 1). The docs' own hardening advice beyond this is OS-level (separate user, container or host).",
        "probes": {
            "P3": P("not-defined", "not-defined", "fetch is not defined.", E + "hardened-P3.txt"),
            "P4": P("not-defined", "not-defined", "module access rejected; Deno not defined.", E + "hardened-P4.txt"),
            "P5": P("not-defined", "not-defined", "process is not defined.", E + "hardened-P5.txt"),
            "P6": P("limited", "limited (5 s wall)", "timeout after 5,003 ms; concurrent cell returned 42 in 144 ms; later cell 42.", E + "hardened-P6.txt"),
            "P7": P("limited", "limited (16 MiB)", "InternalError: out of memory after 464 ms; peak host RSS 376 MB; concurrent and later cells returned 42.", E + "hardened-P7.txt"),
            "P9": P("works", "parallel (215 ms)", "5 lookups 215 ms, 5 host calls; 40 calls in 1,018 ms (waves of 8).", E + "hardened-P9.txt"),
            "P12": P("blocked", "blocked", "Same as default.", E + "hardened-P12.txt"),
        },
    },
    "defaults": dict(SHARED_DEFAULTS, memory="memoryLimitBytes 64 MiB as the QuickJS engine memory limit (clamp 1 MiB-1 GiB), fixed maxStackSize; serialized suspended state capped by maxSnapshotBytes 10 MiB (code-mode.worker.ts:264-265; code-mode-runtime.ts:111-113). Not a Gateway RSS limit."),
    "source_notes": source_notes("openclaw-codemode-quickjs-wasi"),
    "surprises": [
        "QuickJS is opt-in: the default executor is Node (not a security boundary), and 'auto' activation engages Code Mode for preferred models without selecting QuickJS. Only an explicit executor: 'quickjs' gets this isolation.",
        "The plugin's register() is empty; selection works through the manifest's codeModeExecutors contract and a public-surface module load, and an explicit executor choice bypasses plugins.allow for this bundled plugin (src/plugins/code-mode-executor.ts:15-66).",
        "A runtime 'process is not defined' is reported as invalid_input 'code mode module access is disabled.' (shorter text than the Node executor's), which hides the real ReferenceError.",
        "A trailing expression yields null (documented in the exec schema), so the SPEC's P2 form returns no value; only `return` does.",
        "No docs-vs-code mismatch found on isolation: the docs' 'no ambient filesystem, networking, subprocess, environment, or module access' matched every probe.",
    ],
}

write("openclaw-codemode-node-vm", node)
write("openclaw-codemode-quickjs-wasi", qjs)
