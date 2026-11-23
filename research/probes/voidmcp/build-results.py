# Writes research/probes/results/voidmcp.json. Outcome words and details were written by hand from the reviewed out/ files.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
V = "https://github.com/voidmind-io/voidmcp/blob/22e37f12b5e720f253faab854256e681292d635c/"
Q = "https://github.com/fastschema/qjs/blob/461716f4f380f81ffd09378751f1812919cddbca/"
O = "research/probes/voidmcp/out/"
H = "--timeout 5s --memory 8 --max-tool-calls 10 --pool-size 1"

def pr(outcome, detail, ev, display):
    return {"outcome": outcome, "detail": detail, "evidence": O + ev if not ev.startswith("research") else ev, "display": display}

res = {
  "impl": "voidmcp",
  "name": "VoidMCP (Go MCP proxy with QuickJS-in-WASM code mode)",
  "source": "https://github.com/voidmind-io/voidmcp",
  "pinned": "22e37f12b5e720f253faab854256e681292d635c (main). Ran the v0.0.10 darwin-arm64 release binary (tarball sha256 f8b54b632400cdea53926e9eef6c55be7b6df8680034d13312376569cdd64b75); v0.0.10 tags 3a4d33b, and `git diff 3a4d33b 22e37f1` is empty (the two later commits are a fix and its revert). Embedded deps: github.com/fastschema/qjs v0.0.6 (commit 461716f), tetratelabs/wazero v1.9.0 (go.mod).",
  "language": "JS",
  "engine": "quickjs-ng compiled to WASM (fastschema/qjs v0.0.6) on the wazero pure-Go WASM runtime, WASI preview 1, with an empty host temp directory mounted read-write as '/'. A fresh runtime per execution from a pre-warmed pool.",
  "how_run": "voidmcp serve --stdio --db <probe-local db> on macOS arm64 (host, not Docker), with HOME pointed at the probe folder and PROBE_SECRET=s3cr3t in its env; the lookup server (research/probes/voidmcp/lookup-server.mjs) registered with `voidmcp add --db ... lookup \"node lookup-server.mjs calls.log\"`; probes sent as MCP tools/call execute_code by run-probes.mjs, no LLM.",
  "probes": {
    "P1": pr("works", "printed 42 via logs; 1 host call; 230 ms. Tool results arrive unwrapped (JSON text content parsed into an object).", "P1.txt", "works (42, 1 call)"),
    "P2": pr("works", "Both come back in one JSON text: logs[] and result. All 200,000 printed chars came back (response 200,071 chars), no truncation and no marker. The literal spec form (bare last expression) returns no result field because code is wrapped in an async function; `return \"RETURNED\"` gives result \"RETURNED\".", "P2.txt", "works (200,000 chars, no cap)"),
    "P3": pr("not-defined", "fetch: ReferenceError: fetch is not defined. XMLHttpRequest and WebSocket undefined. The qjs:std module is importable (see P4) but std.urlGet is not a function in the WASI build.", "P3.txt", "not-defined"),
    "P4": pr("blocked", "require: ReferenceError; import('fs'): could not load module. But `await import('qjs:std')` and `import('qjs:os')` succeed despite the preamble deleting the std/os globals. std.open('/etc/hosts') fails with errno 44 (ENOENT) because WASI '/' is an empty host temp dir; '../../..' fails with errno 63 (ENOTCAPABLE). The guest CAN create files: std.open('/probe-written.txt','w') wrote a real file under $TMPDIR/voidmcp-sandbox-*/ on the host.", "P4.txt", "blocked (empty WASI root, writable)"),
    "P5": pr("blocked", "process is not defined; std.getenviron() via import('qjs:std') returns {} because wazero gets no env. PROBE_SECRET was set in the voidmcp process env and was not visible.", "P5.txt", "blocked (WASI env empty)"),
    "P6": pr("no-limit-within-120s", "Harness stopped waiting at 120,000 ms. The documented 30 s default timeout never fired. A ping sent after 120 s got no answer within 5 s: the stdio server handles requests inline, so one loop wedges the whole proxy. Harness killed the process.", "P6.txt", "no-limit-within-120s (server wedged)"),
    "P7": pr("no-limit-within-120s", "The 16 MB limit only refuses single allocations above it: a 20 MB string fails with InternalError: out of memory, but 200 x 1 MB strings (200 MB) succeed (out/P7-small-allocs.txt). Spec P7 run 1 (heavier machine load): process-tree RSS reached 3.9 GB, no error, harness timeout at 120 s. Run 2: harness killed the process at 4.2 GB after 26.6 s (baseline 91 MB). Host process had to be killed; no error reached the caller.", "P7.txt", "no-limit-within-120s (killed 4.2 GB)"),
    "P8": pr("works", "fresh for JS globals (second execution printed gone). But files written to the WASI root persist across executions in the same serve process: exec 1 wrote /kept.txt, exec 2 read back \"7\" (P8-fs-exec1/2).", "P8.txt", "fresh (globals); files persist"),
    "P9": pr("works", "serial: 1,018 ms measured inside the sandbox for 5 Promise.all lookups, 5 host calls, each ~201 ms back to back. The bridge callback runs the tool call synchronously before resolving the promise.", "P9.txt", "serial (1,018 ms)"),
    "P10": pr("works", "Returned as isError with {\"error\":\"Error: probe-boom\"}: message only, no stack and no line number (also for a throw on user line 3). Syntax errors do carry a position, offset by the wrapper (\"SyntaxError: variable name expected at script.js:19:46\" for user line 1).", "P10.txt", "message only (no line)"),
    "P11": pr("works", "median 5.99 ms, p90 6.57 ms per execute_code round trip over stdio (20 runs; reported duration_ms 0). One-time setup: spawn to initialize response 339 ms (pool of 4 WASM runtimes pre-warmed). Load average was 32 during the run.", "P11.txt", "works (6.0 ms median)"),
    "P12": pr("blocked", "this.constructor... TypeError (this is undefined inside the async wrapper); globalThis.constructor.constructor('return typeof process')() -> undefined; Function('return this')().process -> undefined; os.exec and std.popen: not a function (WASI build). The per-execution randomized __bridge_<hex> global is enumerable and callable directly, but it only dispatches to registered tools.", "P12.txt", "blocked"),
  },
  "hardened": {
    "config": "voidmcp serve --stdio " + H + ". All four are documented serve flags (README.md Configuration section lines 160-171; cmd/voidmcp/main.go:59-64). --timeout 5s and --memory 8 are stricter than the 30 s / 16 MB defaults; --max-tool-calls 10 is stricter than 50.",
    "probes": {
      "P3": pr("not-defined", "same as default: fetch not defined, std.urlGet not a function.", "hardened-P3.txt", "not-defined"),
      "P4": pr("blocked", "same as default: /etc/hosts ENOENT, '..' ENOTCAPABLE, guest can still write files into its host temp root.", "hardened-P4.txt", "blocked (empty WASI root, writable)"),
      "P5": pr("blocked", "same as default: process undefined, std.getenviron() = {}.", "hardened-P5.txt", "blocked (WASI env empty)"),
      "P6": pr("no-limit-within-120s", "--timeout 5s had no effect: harness timeout at 120,001 ms, ping unanswered, proxy wedged and killed by the harness.", "hardened-P6.txt", "no-limit-within-120s (5 s flag ignored)"),
      "P7": pr("no-limit-within-120s", "--memory 8 refuses a single 20 MB string but not 200 x 1 MB (hardened-P7-small-allocs.txt). Spec P7: harness killed the process at 4.2 GB process-tree RSS after 30.3 s.", "hardened-P7.txt", "no-limit-within-120s (killed 4.2 GB)"),
      "P9": pr("works", "serial: 1,010 ms inside the sandbox, 5 host calls. Separately, the --max-tool-calls 10 cap held: a 60-call loop stopped at exactly 10 host calls, but the error surfaced as \"[uninitialized]\" and the script's own try/catch did not catch it (hardened-P9cap.txt).", "hardened-P9.txt", "serial (1,010 ms)"),
      "P12": pr("blocked", "same as default; no attempt reached the host.", "hardened-P12.txt", "blocked"),
    },
  },
  "defaults": {
    "time": "Documented --timeout 30s (cmd/voidmcp/main.go:63) is passed to qjs.Option.MaxExecutionTime (internal/executor/pool.go:72), which fastschema/qjs v0.0.6 forwards to New_QJS but never uses (qjswasm/qjs.c:15-41 has no interrupt handler). No context deadline is set either. Effective: none (P6).",
    "memory": "Documented --memory 16 MB (main.go:62) becomes JS_SetMemoryLimit (qjs.c:33-34). Observed: only single allocations above the limit fail; total heap grows to the 4 GB wasm32 ceiling (P7). Cause guessed, not verified: quickjs-ng's malloc accounting does not track usable size in this WASI build.",
    "output": "No cap. 200,000 logged chars came back whole (P2). Code input is capped at 256 KB (executor.go:22) and HTTP bodies at 512 KB (server.go:148).",
    "tool_calls": "50 per execution (--max-tool-calls, main.go:64), enforced in the bridge (executor.go:177-182); verified at 10 in the hardened run.",
  },
  "source_notes": [
    {"topic": "API shape", "finding": "Tools are reached as tools.<server>.<tool>(args) through two nested ES Proxies that call one randomized async Go bridge with (server, tool, JSON args). TypeScript declarations (`declare namespace tools.<server> { function x(args: {...}): Promise<T> }`) are generated from each tool's JSON Schema, and return types are inferred from the first real response and stored in SQLite.", "evidence": V + "internal/executor/executor.go#L344-L381 ; " + V + "internal/executor/types.go#L34 ; README.md#L131-L141"},
    {"topic": "Discovery", "finding": "On demand. The execute_code description lists each server with at most 5 tool names; full signatures come from the search tool, which does case-insensitive substring scoring over server, name and description and returns at most 50 matches (\"*\" browses all). Scales past 100 tools without putting every schema in the prompt.", "evidence": V + "internal/executor/types.go#L95-L120 ; " + V + "internal/server/server.go#L509 ; " + V + "internal/registry/registry.go#L258-L300"},
    {"topic": "Bridge", "finding": "qctx.SetAsyncFunc registers an async host function, but its callback calls the upstream MCP tool synchronously (entry.call) before resolving the promise, so Promise.all over tool calls runs serially (P9) even though the tool description tells the model to fan out with Promise.allSettled.", "evidence": V + "internal/executor/executor.go#L176-L248 (synchronous call at L213); prompt at " + V + "internal/server/server.go#L262"},
    {"topic": "Isolation boundary", "finding": "Engine is quickjs-ng in WASM on wazero with WASI, which is a real boundary for network, env and host files (P3-P5, P12). The preamble deletes the std/os/bjson globals, but qjs registers them as 'qjs:std'/'qjs:os' modules that dynamic import() still loads. The WASI root is an empty host temp dir mounted read-write, shared by every execution in a serve process and left behind when the process is killed, so the README's \"no access to the host filesystem\" is not quite true: guest code can write host files there without a quota (writes measured, quota absence inferred from source).", "evidence": V + "internal/executor/executor.go#L28-L43 ; " + Q + "qjswasm/qjs.c#L7-L9 ; " + Q + "qjswasm/helpers.c#L163-L170 ; " + Q + "runtime.go#L135-L148 ; " + V + "internal/executor/pool.go#L37-L41 ; out/P4.txt, out/P8.txt, out/sandbox-dir-leftovers.txt"},
    {"topic": "Output channel", "finding": "One JSON text with result, error, logs[], tool_calls[] (server, tool, ms, status) and duration_ms. Error results set isError. No truncation anywhere.", "evidence": V + "internal/server/server.go#L593-L615"},
    {"topic": "Limits", "finding": "Time and memory flags exist and are wired to qjs options, but the time option is a no-op in the pinned qjs and the memory limit only bounds single allocations in practice. Tool-call cap works. Concurrency is bounded by --pool-size (4).", "evidence": V + "cmd/voidmcp/main.go#L59-L64 ; " + V + "internal/executor/pool.go#L66-L80 ; " + Q + "qjswasm/qjs.c#L15-L41 ; out/P6.txt, out/P7.txt"},
    {"topic": "State", "finding": "Fresh runtime per execution (Acquire closes the pre-warmed placeholder and builds a new runtime bound to the request ctx; Release discards it). JS globals do not persist; files in the shared WASI root do.", "evidence": V + "internal/executor/pool.go#L85-L130 ; out/P8.txt"},
    {"topic": "Errors", "finding": "The wrapper catches and stores only e.name + ': ' + e.message, dropping the stack and line. A tool-call-limit rejection surfaced as \"[uninitialized]\".", "evidence": V + "internal/executor/executor.go#L262-L270 ; out/P10.txt ; out/hardened-P9cap.txt"},
    {"topic": "Credentials", "finding": "Kept on the host side of the bridge: auth tokens are stored AES-256-GCM encrypted in SQLite, attached by the Go transport, and can only be registered from the CLI, not by the model's add_mcp tool. stdio upstreams get only PATH, HOME, TMPDIR, LANG. The sandbox never sees tokens or env.", "evidence": V + "internal/store/store.go#L139 ; " + V + "internal/transport/stdio.go#L52-L59 ; README.md Security section"},
    {"topic": "Concurrency of the stdio server", "finding": "ServeStdio reads a line and calls Handle inline, so one long execute_code blocks every other request on that connection, including ping (P6).", "evidence": V + "internal/server/server.go#L176-L200"},
  ],
  "surprises": [
    "--timeout is documented (README line 168, default 30s) but never enforced: fastschema/qjs v0.0.6 accepts max_execution_time and ignores it, and voidmcp sets no context deadline. while(true){} ran past 120 s in default and hardened (--timeout 5s) runs and wedged the stdio server.",
    "--memory is documented as a per-execution limit (README line 167, default 16 MB) but in practice only refuses single allocations above it; a loop of 1 MB strings reached 4.2 GB process RSS (harness kill) with both 16 MB and 8 MB settings.",
    "The README says the sandbox has no access to the host filesystem (lines 129, 176). Reads of host files are blocked, but guest code can write files into a real host temp directory ($TMPDIR/voidmcp-sandbox-*), those files persist across executions in the same process, and the directory is left behind when the process dies.",
    "The preamble deletes globalThis.std/os, but `await import('qjs:std')` and `import('qjs:os')` still load. The WASI build makes their dangerous functions (exec, popen, urlGet) unavailable, so this did not lead to an escape.",
    "The tool description recommends Promise.allSettled fan-out for parallel calls (server.go:262), but the bridge is synchronous and five calls took 1,018 ms.",
    "The randomized bridge name is meant to stop user code calling the bridge directly (executor.go:170-172), but it is an enumerable global; P12 found and called it. It only reaches registered tools, so no new capability.",
    "Thrown errors lose stack and line number; only `Error: probe-boom` reaches the model.",
    "`voidmcp add <name> <target> --db X` ignores the trailing flag (Go flag parsing stops at the first positional) and silently wrote to ~/.voidmcp instead. The README's `voidmcp add github https://mcp.github.com --token ghp_...` has the same shape, so the token would be silently dropped (inferred, not run with a token). out/flag-order.txt.",
    "With --max-tool-calls the limit holds, but the caller sees error \"[uninitialized]\" instead of the limit message, and an in-script try/catch did not catch it.",
    "initialize reports serverInfo version \"dev\" while `voidmcp version` prints 0.0.10.",
  ],
}
out = os.path.join(HERE, "../results/voidmcp.json")
json.dump(res, open(out, "w"), indent=2, ensure_ascii=False)
for k, v in list(res["probes"].items()) + list(res["hardened"]["probes"].items()):
    assert len(v["display"]) <= 40, (k, v["display"], len(v["display"]))
print("wrote", os.path.abspath(out))
