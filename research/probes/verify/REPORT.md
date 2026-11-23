# Independent verification: code-mode sandboxes for a shared server running model-written code

Reviewer run, 2026-11-22, on the shared 36 GB Mac (14 cores, load average 37 to 45 from other workers during the runs, so absolute timings are inflated). Nothing in `results/`, `src/` or other workers' folders was edited. Everything below is under `research/probes/verify/`.

## What was done

1. **Gate reproduction.** Each worker's harness was copied unchanged (only relative paths adjusted) to `verify/<impl>/repro/` and rerun for P3, P4, P5, P6, P7, P9, P12, default and hardened. Outputs: `verify/<impl>/repro/out/`, logs `verify/<impl>/repro/gates.log`. The copies that write `results/*.json` (`build-results.py`, `probe_core.py collect`) were removed or not called.
2. **Robustness checks** (R1 to R9, plus asb-specific A1 to A5), all through the same public entry point each original harness used, against **one shared instance** per process (one tool / agent / server / runner, as a multi-user server would hold it). Harness: `verify/_js/rcore.mjs` (JS hosts), `verify/_py/rcore.py` (Python hosts), adapters `verify/<impl>/adapter.{mjs,py}`. Every test runs in its own process under `verify/_js/rwatch.mjs`, which samples the RSS of the whole process tree every 50 ms and SIGKILLs it at 4 GB or 120 s. Memory-heavy tests went through `mem-lock.sh`. Raw records: `verify/<impl>/out/<config>-<test>.json`. One-line digest of all of them: `verify/robust-summary.txt`; neighbor table: `verify/neighbor-table.txt`.
3. **Source reading** of the bridge, error path and limit code at the pinned versions.

Rerun: `bash research/probes/verify/run-all-robust.sh [impl ...]` (robustness), `research/probes/verify/<impl>/repro/gates.sh` (gates), `python3 research/probes/verify/summarize.py` (digest).

**Second pass (same day): openclaw-codemode-quickjs-wasi, strands-codemode, bifrost-codemode, hermes-execute-code (hardened only).** Same method, same tests. Harness changes are backward compatible: `rwatch.mjs` now also samples the process tree's macOS `phys_footprint` through `_js/footprint.py` (RSS hides compressed pages) and kills at 4 GB of either. `rcore.mjs` accepts `a.normalCode`, lets `extraTests` override a test id (non-JS guests), passes `neighbor`, and records `a.stats()` as `adapterStats`. `rcore.py` accepts `override_codes` (`None` = not applicable) and `stats()`. Docker containers: `bifrost-codemode-verify` and `-verify-gates` (ports 42410 to 42413), `hermes-execute-code-<hex>` (prefixed in-process); all were removed. `neighbor.py` generates the new neighbor-table rows. Bifrost's own driver is `verify/bifrost-codemode/run.sh` (it restarts the gateway container per test).

### The robustness tests (JS form; Python equivalents in `_py/rcore.py:py_codes`)

`T`, `F`, `R` are the implementation's names for three host tools: `lookup` (200 ms, `{id, value: id*2}`), `failing` (throws `Error("host-tool-boom internal detail db=postgres://user:pw@host")`), `rich` (returns `{fn: () => ..., d: new Date(0), m: new Map(), s: "plain"}`). `OUT(x)` is `return (x)` or `console.log(JSON.stringify(x))`.

| id | what a buggy/misaligned model writes | code |
|---|---|---|
| R1 | leaves state on shared prototypes/globals, next execution reads it | A: `Object.prototype.polluted="A"; Array.prototype.leak="A"; globalThis.leftover="A-secret"; JSON.stringify=function(){return "hijacked"}; Math.random=()=>4` then B: `OUT([typeof ({}).polluted, typeof [].leak, typeof globalThis.leftover, JSON.stringify({a:1}), Math.random()===4])` |
| R1c | same, while A is still running (awaiting two tool calls) | A: `Object.prototype.pollutedC="A"; globalThis.leftC="A-secret"; await T({id:1}); await T({id:2})`; B starts 100 ms later |
| R2a | reaches for host objects through a tool result / tool function | `const r = await T({id:1}); OUT([Object.getPrototypeOf(r)===Object.prototype, r.constructor.constructor("return typeof process")(), T.constructor("return typeof process")(), Object.getOwnPropertyNames(globalThis)])` (each wrapped in try) |
| R2b | inspects a host tool's error | `try { await F() } catch (e) { OUT({name, message, stack, own props, e.constructor.constructor("return typeof process")()}) }` |
| R2c | tool returns a non-JSON host value | `const r = await R(); OUT({keys, typeof r.fn, r.fn(), String(r.d), JSON.stringify(r.m)})` |
| R3 | deep recursion; hands a 100,000-deep structure back to the host | `function f(n){return f(n+1)+1}; try{f(0)}catch(e){...}` / `const root=[]; let x=root; for(i<1e5){x[0]=[];x=x[0]} OUT(root)` / then `OUT("alive")` |
| R4 | catastrophic regex | `/^(a+)+$/.test("a".repeat(40)+"b")` |
| R5 | many tool calls | `await Promise.all(Array.from({length:2000},(_,i)=>T({id:i})))`; host call counts at return and 3 s later |
| R6 | busy loop after an await | `await T({id:1}); while (true) {}` |
| R7a | promise that never settles | `await new Promise(() => {})` |
| R7b | tool calls in flight when the limit fires | `for (let i=0;i<5;i++) T({id:i}); while (true) {}` |
| R8a / R8b | very large output | `console.log("x".repeat(20*1024*1024))` / `OUT("y".repeat(20*1024*1024))` |
| R9a-e | **neighbor**: a second, normal request B (`const r = await T({id:21}); OUT(r.value)`) issued 150 ms after an aggressor on the same shared instance | aggressor: R9a `while(true){}`, R9b `const a=[]; while(true) a.push("x".repeat(1e6))`, R9c `while(true) console.log("x".repeat(1e6))`, R9d the R4 regex, R9e eight concurrent `while(true){}` |

Harness caveats, stated once: (a) in R7b the `later` count includes the follow-up `after` request, so "+1" there is mine, not a zombie call; (b) asb's `corpus.read` takes a positional id, so asb neighbor requests print `null` instead of 42 (the call itself succeeded); (c) the first utcp R9c run and pi R5 lost their records to a stdout-truncation bug in my harness and were rerun after it was fixed (record now passed by file).

## Summary across candidates

| | timeout holds across awaits / never-settling promise | host memory bounded under log flood (R9c) | other users unaffected (R9a-e) | host error text reaches guest/model (R2b) | output cap (R8) | tool-call cap (R5) |
|---|---|---|---|---|---|---|
| vercel-run | yes (CPU 10 s, wall 30 s) | yes (≤171 MB) | yes (B ≤ +146 ms) | no, "Host function failed." | yes | 32 in flight (8 hardened) |
| vercel-ai-sdk-codemode | yes | yes | yes (≤ +274 ms) | no, "Host tool failed." | yes | 32 / 8 in flight |
| pydantic-ai-harness-codemode | yes (30 s, sleep capped) | yes | yes (≤ +28 ms) | **yes, verbatim** | 10 MiB print cap | 100 per snippet |
| fastmcp-codemode | yes (30 s) | yes | yes (≤ +52 ms) | **yes**, unless `mask_error_details=True` | no (prints to server stdout) | 50 |
| langchain-quickjs | partly: **log flood ran 51 s vs 5 s, 40 s vs 1 s** | yes | yes (≤ +116 ms) | no, "Host function failed" | yes (truncated) | 256 / 8 |
| pi-codemode | default **no** (300 s); hardened yes | yes (16 M-char cap) | yes (≤ +4 ms) | **yes, verbatim** | 16 M chars | **none (2,000 concurrent)** |
| tanstack-ai-codemode-node | **no**: R7a and R5 never returned (>110 s) | **no: 4.1 GB host in 54 s** (default) | yes, until the host OOMs | **yes, verbatim** | **none** | none |
| utcp-codemode | yes (host timer) | **no: >4 GB host in 0.5-13 s** | yes, until the host OOMs | **yes, verbatim + HTTP body** | **none** | none |
| asb-quickjs | **no**: R5 >110 s past the 60 s deadline | **no: 3.3 GB, then runCode rejects** | **no: B waited 60 s / 76 s** | **yes, verbatim** | 8,000 chars, but only after buffering | none |
| openclaw-codemode-quickjs-wasi | yes (10 s / 5 s wall; pending promise refused in 0.25 s) | yes (≤472 MB) | **no: 4 busy cells fill the 4-worker pool; B waited 10.2 s or failed (timeout)** | partly: verbatim except pattern-redacted secrets (`user:***@host`) | yes (512 units per console string, 64 KiB marker) | 16 in flight + 128 queued (8 hardened); excess rejects the program |
| strands-codemode | default 60 s VM time + 900 s wall; hardened 10 s wall (no `asyncio.sleep` for R7a) | yes (200 k chars) | yes (≤ +202 ms) | **yes, verbatim** | 200,000 chars + marker | 1,000 suspensions, 10 concurrent; in-flight calls cancelled |
| bifrost-codemode | yes (step budget; no async) | **no: 8 concurrent recursions 3.4 GB, 12 hit 4.1 GB and the gateway died** | yes for loops/bombs/floods (≤ +28 ms); **no for recursion** | **yes, verbatim** | run fails over 64 KiB (no truncation) | 64 serial (8 hardened) |
| hermes-execute-code (hardened Docker) | yes, but stops at 11 to 18.6 s for a 10 s limit | yes (512 MB per container) | slowed, none failed (B 2 s → 6.7 to 11.3 s) | **yes, to the model via `tool_errors`** (guest copy redacted) | 50 KB head+tail | 50; serial file RPC (~30 calls in 10 s) |

---

## vercel-run (run 2.1.13, `6c146567`)

### Gate reproduction

| cell | JSON says | I measured (`verify/vercel-run/repro/out/`) | match |
|---|---|---|---|
| P3 | not-defined | `ReferenceError: fetch is not defined` | yes |
| P4 | not-defined | `require is not defined`; `import("fs")`: `could not load module 'fs'` | yes |
| P5 | not-defined | `process is not defined` | yes |
| P6 | limited (10 s CPU) | `RUN_CPU_TIMEOUT ... 10000ms` at 10.3 s; sibling returned 42 | yes |
| P7 | limited (64 MiB) | `out of memory` at 1.26 s; sibling 42, next run 42 | yes |
| P9 | parallel (259 ms) | parallel, 416 ms in-guest (load avg ~45) | yes (outcome) |
| P12 | blocked | `Function constructor is not allowed`; `this.process` undefined; canary invisible | yes |
| H P3/P4/P5/P12 | as default | as default | yes |
| H P6 | limited (5 s CPU) | 5,225 ms | yes |
| H P7 | limited (32 MiB) | OOM at 0.79 s | yes |
| H P9 | parallel (257 ms) | 359 ms | yes |

### New findings
- **Neighbors unaffected by every aggressor** (`verify/neighbor-table.txt`): B started ≤146 ms late and returned 42 while a loop, memory bomb, log flood, regex bomb, or eight loops ran. Each run is in a pooled worker thread; CPU and wall limits stopped every aggressor (R4/R6/R7b/R9d CPU 10 s or 5 s; R7a wall 30 s / 15 s). Files: `vercel-run/out/{default,hardened}-R9*.json`, `-R4`, `-R6`, `-R7a`.
- **R5**: the 33rd concurrent call fails with `RunBridgeLimitError ... 32 in-flight` (8 hardened), but the 32 calls already dispatched keep running on the host to completion after the program has been answered (`atReturn {started 32, done 0}`, 3 s later `done 32`; `default-R5.json`). For side-effecting tools on a shared server, tools must honor the abort signal Run passes.
- **R2a**: `host.lookup.constructor` is a proxy property, so it becomes a bridge request for `host.lookup.constructor`, which the host refuses (`RunDetachedBridgeRequestError`, `out/R2a-split.txt`). The host resolver accepts only manifest names that are own, enumerable data properties (`pkg/node_modules/run/dist/host-function-invocation.js:46-79`), so no inherited-key path exists. Not a finding; noted because asb fails exactly this check.
- R3 deep structure: refused at serialization, host survives. R2c: function in a tool result is rejected (`output is not serializable at .fn`).

### Credentials and tool results (source)
Tools run on the main thread; the guest sees only serialized values. Host errors become `Host function failed.` unless the host throws a `RunError` (measured R2b: message gone, stack is guest-only). Credentials stay host-side.

## vercel-ai-sdk-codemode (@ai-sdk/code-mode 1.0.136 over run 2.1.13)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 / P4 / P5 | not-defined | not defined / could not load module / not defined | yes |
| P6 | limited (10 s CPU) | `CODE_MODE_CPU_TIMEOUT` 10,471 ms; sibling 42 | yes |
| P7 | limited (64 MiB) | OOM 1.12 s; sibling 42 | yes |
| P9 | parallel (257 ms) | 354 ms | yes |
| P12 | blocked | Function constructor not allowed (also via `tools.lookup.constructor`) | yes |
| H P6 / P7 / P9 | 5 s CPU / 32 MiB / 261 ms | 5,274 ms / OOM 0.39 s / 308 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
Same engine and the same outcomes as vercel-run in every robustness test: neighbors ≤274 ms late, all aggressors stopped by their own limit, 32/8 in-flight cap with the same "dispatched calls keep running" caveat (`vercel-ai-sdk-codemode/out/default-R5.json`). R2b: host error replaced by `Host tool failed.`. R2c: functions dropped, `Date` becomes an ISO string, `Map` becomes `{}`.

## tanstack-ai-codemode-node (@tanstack/ai-code-mode 1.1.2, isolated-vm 6.2.0, `c695ada5`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 / P4 / P5 | not-defined | not defined / `Not supported` / not defined | yes |
| P6 | limited (30 s) | `Script execution timed out.` 30,078 ms; sibling 42 | yes |
| P7 | limited (128 MB), execute throws | `Isolate is already disposed` thrown at 1.75 s; sibling and next run 42 | yes |
| P9 | serial (1,030 ms) | 1,011 ms | yes |
| P12 | blocked | `process is not defined` (also P12b-j) | yes |
| H P6 / P7 / P9 | 5 s / 32 MB throws / 1,012 ms | 5,174 ms / throws at 0.3 s / 1,023 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **The timeout does not cover time spent awaiting.** `await new Promise(() => {})` never returned within 110 s, default and hardened (`out/default-R7a.json`, `out/hardened-R7a.json`). Two thousand serial tool calls ran 546 calls in 110 s and were still going, past the 30 s and 5 s limits (`default-R5.json`, `hardened-R5.json`). Cause: the only bound is `script.run(this.context, { timeout, promise: true })` (`repo/packages/ai-isolate-node/src/isolate-context.ts:59-62`), and isolated-vm's timeout covers synchronous execution only. Busy loops after an await are stopped (R6 30.2 s / 5.2 s). **Why it matters:** one model program holds a request, an isolate and its memory indefinitely, and keeps calling tools on sensitive data with no ceiling.
2. **A log flood kills the host.** `while (true) console.log("x".repeat(1e6))` drove host RSS to 4.1 GB at 54 s, where the harness killed it (`default-R9c.json`; tanstack's own error log showed `logCount: 135438`). In hardened mode it peaked at 2.66 GB before the 5 s timeout fired at 7.8 s (`hardened-R9c.json`). Cause: each guest `console.log` calls `__captureLog.applySync`, which pushes into an unbounded host array `logs` (`isolate-driver.ts:155-160`, console shim `:163-189`). The 32 MB / 128 MB isolate limit does not apply to it. **Why it matters:** one execution can take the whole Node server down for every user.
3. **No output cap.** 20 MB of logs and a 20 MB return value pass straight back (`default-R8a.json`, `default-R8b.json`).
4. **Host error text reaches the guest and the model verbatim**, e.g. `host-tool-boom internal detail db=postgres://user:pw@host` (`default-R2b.json`), from `error.message` in the tool reference (`isolate-driver.ts:203-207`). The stack is guest-only.
5. Not a finding: the guest can see the raw `__external_*_ref` References, but calling one directly still goes through host-side zod validation (`ref_check.mjs` → `out/ref_check.txt`).

Neighbors were unaffected wherever the host survived (B ≤10 ms late).

## pi-codemode (@earendil-works/pi-codemode 1.6.0, `fb248c7f`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 / P4 / P5 | not-defined | not-defined (all three P4 forms fail) | yes |
| P6 | no-limit-within-120s (300 s default) | killed by watcher at 120 s | yes |
| P7 | limited (wasm32 4 GiB, 3.5 GB RSS) | `InternalError: out of memory` at 27.6 s, **peak 1,064 MB**; next run "alive" | outcome yes; the RSS figure is one sample (other workers' runs saw 1.87 and 3.49 GB) |
| P9 | parallel (209 ms) | 208 ms | yes |
| P12 | blocked | all five attempts undefined / blocked | yes |
| H P6 / P7 / P9 | 30 s / 32 MiB / 204 ms | 30,004 ms / OOM 0.2 s / 270 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Defaults are not safe for a shared server.** R4, R6 and R7b ran past 110 s (`default-R4.json` killed at 120 s, `default-R6.json`, `default-R7b.json`), and the default memory bomb grew the host tree to 1.58 GB before failing at 16.9 s (`default-R9b.json`). With `timeoutMs: 30000, memoryLimitBytes: 32 MiB` every one of these stops (hardened R4/R6/R7b at 30.0 s, R9b at 124 ms).
2. **No tool-call cap.** 2,000 concurrent host calls were all dispatched and completed in 288 ms (`default-R5.json`, `hardened-R5.json`). One program can fan out thousands of parallel queries against the case-data backend.
3. **Host error text verbatim** (`default-R2b.json`), relayed at `packages/codemode/src/runtime/execution.ts:396`.
4. Good: a worker thread per execution meant neighbors were never more than 4 ms late, even under eight loops. A never-settling promise is detected in about 100 ms (`default-R7a.json`). A 16 M-character output cap stopped the log flood in 171 ms (`default-R9c.json`; `prelude-source.ts:42-43`). Prototype pollution did not cross executions.

## utcp-codemode (@utcp/code-mode 1.2.13, isolated-vm 6.0.2, `e5fdc319`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 / P4 / P5 / P12 | not-defined (`display` missing in the default block) | not defined / not supported / not defined / `process is not defined` | yes (the missing `display` breaks RUBRIC) |
| P6 | limited (30 s) | `Script execution timeout after 30000ms` at 30.0 s | yes |
| P7 | limited (128 MB) | `Isolate was disposed during execution due to memory limit` at 2.1 s, host peak 209 MB | yes |
| P9 | works, serial | 1,069 ms | yes |
| H P6 / P7 / P9 | 10 s / 64 MB / serial (1,019 ms) | 10,010 ms / disposed at 0.98 s / 1,031 ms | yes |
| H P3/P4/P5/P12 | not-defined | as default | yes |

### New findings
1. **A log flood exhausts host memory despite the isolate limit.** R9c crossed 4 GB host RSS in 12.6 s by default and in 0.5 s with the 64 MB hardened isolate (`default-R9c.json`, `hardened-R9c.json`). An earlier run of each peaked at 3.9 GB and 3.0 GB and then left the process wedged until the 120 s kill. Cause: the console shim pushes every line into an unbounded host-side `logs` array (`typescript-library/src/code_mode_utcp_client.ts:399-400`). **Why it matters:** this is a server crash triggered by an ordinary debugging loop.
2. **Host error text, plus any HTTP error body, is passed into the sandbox**: `errorMsg += " Error data: " + JSON.stringify(error.response.data)` (`code_mode_utcp_client.ts:446-449`). Measured with the fake DSN (`default-R2b.json`).
3. **No output cap**: 20 MB of logs and return pass through (`default-R8a/R8b.json`). Tool calls are serial.
4. Good: the host timer bounds time spent awaiting (R5 and R7a stopped at 30 s / 10 s, with abandoned calls warned). Neighbors were never more than 7 ms late while the host lived.
5. Operational: after use, the process does not exit on `process.exit` until killed (seen in the smoke run, which needed the 120 s kill).

## asb-quickjs (this repo, `src/sandbox.ts`, quickjs-emscripten 0.32 asyncify)

### Gate reproduction (`verify/asb-quickjs/repro/out/run.log`, `P7-rss.txt`)

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | `'fetch' is not defined` | yes |
| P4 | not-defined | `'require' is not defined`; `import("fs")` ends the program with `Lifetime not alive`; the next run is fine | yes |
| P5 | not-defined | `no process` | yes |
| P6 | limited (60 s) | `interrupted` at 60,013 ms | yes |
| P7 | limited (512 MB WASM memory) | `out of memory` at 2.0 s. Host max RSS: 577 MB (strings bomb), **1.68 GB (objects bomb)** | outcome yes; the label hides a 3.3× host overshoot |
| P9 | serial (1,006 ms) | 1,010 ms | yes |
| P12 | blocked | `typeof process` undefined in both forms | yes |
| hardened | null | (no options exposed) | n/a |

The `engine` text "fresh module and context per execution" is stale. The compiled module is now shared; the instance, memory and context are fresh (`src/sandbox.ts:38-46`, `:66-68`).

### New findings
1. **One CPU-bound program freezes every other user for the full deadline.** With a guest `while(true){}`, the neighbor request could not start for 59.9 s (`default-R9a.json`: B issued at +150 ms, started at 60,021 ms; host event-loop stall 60,001 ms). The regex bomb did the same (59.9 s, `default-R9d.json`). With eight loops the harness killed the test at 120 s with B still waiting (`default-R9e.json`). Cause: QuickJS-asyncify runs on the host's own thread (`sandbox.ts:97` `evalCodeAsync`), and the interrupt handler is its only preemption. **Why it matters:** on a shared server, one model's loop stops every investigation for 60 s, per program.
2. **The guest can call the bridge with any key, including inherited ones, and make the host serialize the whole `Corpus`.** `__host` is a guest global, and `dispatch` is a plain object literal indexed with `dispatch[call.name]` (`sandbox.ts:49-56`, `:84-87`). `__host(JSON.stringify({name: "constructor", args: []}))` resolves to `Object`. `Object(corpus)` returns the corpus, and the host runs `JSON.stringify(corpus)`: `db`, the full `vectors` Float32Array, and `chunkMsg` (every chunk-to-message id), bypassing every `limit` cap. Stand-in corpus: the guest received 6.49 M chars with 50,000 ids and 200,000 vector entries (`default-A1.json`). Real corpus fields (633 MB `vectors.f32`, real DB): the host was stuck for over 120 s at 1.2 to 2.4 GB RSS, then killed (`default-A1real.json`). A 10% slice takes 6.6 s and produces 496 M chars (`out/stringify-cost.txt`), so the full one is about 5 G chars and about 66 s of synchronous host work. **Why it matters:** one line of model code bypasses the API surface and freezes or crashes the shared server.
3. **A log flood grows host memory without bound and outlives the deadline.** Each `console.log` is pushed to a host array (`sandbox.ts:76`), and the 8,000-char cap applies only after everything is joined (`:118-119`). R9c reached 3.28 GB host RSS, froze the event loop for 75.9 s (past the 60 s deadline; B waited 75.8 s), and then `runCode` itself rejected with `RangeError: Out of memory at join (sandbox.ts:118)`. That error comes from outside the try block, so the MCP tool handler throws (`default-R9c.json`).
4. **The 60 s deadline ignores time spent in host calls.** R5 had made 547 serial calls after 110 s and was still running (`default-R5.json`). `shouldInterruptAfterDeadline` is only consulted while guest bytecode runs (`sandbox.ts:72`), and a program that mostly awaits tools rarely triggers that check.
5. **The memory cap is per execution, and the host overshoot is large and sticky.** One objects bomb costs 1.68 GB host RSS. Three concurrent bombs reached 2.57 GB, and RSS stayed about 1.3 GB after they finished (`repro/out/objects-twice.json`). Six concurrent string bombs peaked at 1.67 GB (`default-A5.json`). Nothing caps concurrent executions.
6. **Host error text reaches the guest verbatim** (`sandbox.ts:91`; `default-R2b.json` shows the fake DSN). `grep` also returns up to 300 chars of rg stderr (`src/search.ts:136`).
7. **Correctness:** the `await` strip is a regex over the whole source, strings included. `"please await  the reply"` printed `please the reply` (`default-A4.json`), and `await new Promise(()=>{})` silently stops waiting (`default-R7a.json` printed `resolved?`).
8. Good: fresh context, so nothing leaks across executions (R1, R1c). Tool results come back only as JSON. A guest `__host("{")` is caught as a guest `SyntaxError`. Deep recursion is contained (`R3`).

**Fix list, if asb stays:** run each execution in a worker thread or use `run`; bind `__host` into the prelude closure and delete the global; use `Object.hasOwn(dispatch, name)` or a `Map`; count bytes in the `log` callback and stop at the cap; add a host-side wall-clock deadline that disposes the VM; cap concurrent executions process-wide; sanitize host errors.

## langchain-quickjs (0.4.0, quickjs-rs 0.3.0, `3285b5ca`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 / P4 / P5 / P12 | not-defined | not-defined in every form (error type and result blocks) | yes |
| P6 | limited (5 s) | `Timeout interrupted`, eval 5.6 s | yes |
| P7 | limited (64 MiB) | `OutOfMemory`, 1.0 s, peak 342 MB; next runs fine | yes |
| P9 | parallel (206 ms) | 211 ms | yes |
| H P6 / P7 / P9 | 1 s / 16 MiB / 206 ms | 1.38 s / OOM 0.5 s / 216 ms | yes |
| H P3/P4/P5/P12 | not-defined | as default | yes |

### New findings
1. **The timeout is not enforced while the guest prints.** The R9c flood ran 51.0 s against a 5 s timeout, and 39.6 s against 1 s hardened, before `Timeout`. 3.33 G chars were produced; host memory stayed at 190 MB because output is truncated (`default-R9c.json`, `hardened-R9c.json`). Neighbors were unaffected, but one request holds a worker 10 to 40 times its budget.
2. **Stack overflow escapes as a wasm `Trap` raised out of `agent.ainvoke`**, so the whole agent turn fails instead of the model receiving a tool error. This happened for both deep recursion and the deep return (`default-R3.json`). It contradicts the results file's source note "Errors never raise to the agent". The host survived, and the next run was fine.
3. Non-JSON tool results are stringified with Python `repr`, so the guest saw `<function rich.<locals>.<lambda> at 0x109ab6ca0>` (`default-R2c.json`), a minor host-address leak.
4. Good: host errors are sanitized to `HostError: Host function failed` (`default-R2b.json`; `quickjs_rs/context.py:32`). There is a 256-call budget (`default-R5.json`). A never-settling promise is caught at once as `Deadlock` (`default-R7a.json`). Each context runs on its own thread, so neighbors were ≤116 ms late. Nothing crossed LangGraph threads (R1, R1c).

## pydantic-ai-harness-codemode (0.71.0, Monty 1.6.0, `8e4f468a`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | ty: cannot resolve `urllib.request` | yes |
| P4 / P5 | blocked | `PermissionError` / `'os.environ' is not supported` | yes |
| P6 | limited (30 s) | feed time limit 30.0 s | yes |
| P7 | limited (256 MiB) | `MemoryError ... > 268435456 bytes` at 0.24 s | yes |
| P9 | parallel (201 ms) | 211 ms | yes |
| P12 | blocked | all attempts blocked | yes |
| H P6 / P7 / P9 | 1 s / 10 MB / 201 ms | 1.08 s / 0.14 s / 204 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Host exception type and message are re-raised inside the sandbox and shown to the model**: `RuntimeError: host-tool-boom internal detail db=postgres://user:pw@host` (`default-R2b.json`, `hardened-R2b.json`; `_monty_exec.py:597-598`, `_raise_in_sandbox`). This is the only weakness found.
2. Good: every aggressor was stopped by its own limit, and neighbors were never more than 28 ms late (worker subprocess). The 101st call is refused and in-flight calls are cancelled (`done` stayed 0, `default-R5.json`). `asyncio.sleep` is checked against the remaining budget (`default-R7a.json`). `re` is linear-time, so R4 returned in milliseconds. Print is capped at 10 MiB (`default-R8a.json`). No state crossed runs.

## fastmcp-codemode (4.2.4, Monty 1.6.0, `5ac27a2c`)

### Gate reproduction

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | `No module named 'urllib'` | yes |
| P4 / P5 | blocked | `PermissionError` / `os.environ not supported` | yes |
| P6 | limited (30.0 s) | 30.2 s | yes |
| P7 | limited (100 MB) | `MemoryError` at 0.13 s | yes |
| P9 | parallel (202 ms) | 205 ms | yes |
| P12 | blocked | blocked | yes |
| H P6 / P7 / P9 | 10 s / 50 MB / 202 ms | 10.1 s / 0.08 s / 204 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Host error text reaches the sandbox** (`call_tool('failing') failed: Error calling tool 'failing': host-tool-boom ... db=postgres://user:pw@host`, `default-R2b.json`; built at `fastmcp/experimental/transforms/code_mode.py:82-84`). The fix exists: `FastMCP(..., mask_error_details=True)` reduces it to `Error calling tool 'failing'` (`mask_check.py` → `out/mask_check.txt`).
2. Good: all aggressors were stopped (30 s / 10 s feed limit, 100 / 50 MB, 1,000-suspension and 50-call caps, `default-R5.json`). Neighbors were never more than 52 ms late. Linear `re`. Fresh state per execute. `await asyncio.sleep(100000)` returned after about 10 s instead of erroring (`default-R7a.json`), which is harmless but odd.

## openclaw-codemode-quickjs-wasi (openclaw 2026.11.6, `06afb10d`, quickjs-wasi 3.6.3)

Adapter `verify/openclaw-codemode-quickjs-wasi/adapter.mjs`: `createCodeModeTools` + `applyCodeModeCatalog` from the published dist (same entry as the worker), the model-facing `exec` tool, and `wait` whenever the status is `waiting`. Shared instance: one `LegacyPluginSdkResourceHost` bound to one `GatewayScheduler`, as the Gateway runs cells, so every execution shares the QuickJS worker pool. Each execution is its own session (a separate user). Hardened = the worker's config (`timeoutMs 5000`, `memoryLimitBytes 16 MiB`, `maxOutputBytes 8192`, `maxPendingToolCalls 8`, ...).

### Gate reproduction (`verify/openclaw-codemode-quickjs-wasi/repro/out/`, `repro/gates.log`)

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | `ReferenceError: fetch is not defined`; fetch, XMLHttpRequest, WebSocket, require, process all `undefined`; the TextDecoder-error path that escapes the Node executor ends in `module access is disabled` | yes |
| P4 | not-defined | `code mode module access is disabled` (invalid_input) for `require` and `import`; `Deno` undefined | yes |
| P5 | not-defined | `module access is disabled` | yes |
| P6 | limited (10 s wall) | `code mode timeout exceeded` at 10,004 ms; concurrent cell returned 42 in 155 ms | yes |
| P7 | limited (64 MiB) | `InternalError: out of memory` at 0.63 s; host peak RSS 437 MB; concurrent and later cells 42 | yes |
| P9 | parallel (207 ms) | 235 ms, 5 calls; 40 calls in 616 ms | yes |
| P12 | blocked | all 12 attempts blocked; the realm scan found no foreign constructor among 551 objects | yes |
| H P6 / P7 / P9 | 5 s / 16 MiB / 215 ms | 5,004 ms / OOM at 1.12 s, peak 399 MB / 224 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Four busy programs block every other user's code until the timeout.** The QuickJS executor runs on one shared `WorkerTaskPool` with `sharedCompute: true` (`extensions/code-mode-quickjs/src/executor.ts:60-69`). Its size is `min(4, availableParallelism() - 1)`, so 4 here (`src/infra/worker-pool-sizing.ts:5-13`, `src/infra/worker-task-host.ts:79`). No config option changes it. A queued cell's wait counts against its own `timeoutMs`. Measured with a normal request B issued 150 ms after N concurrent `while(true){}` programs: 3 loops, B took 367 ms (`default-R9e3.json`). 4 loops, B waited 10,209 ms by default (`default-R9e4.json`) and failed in both hardened runs, first with `snapshot_limit_exceeded` and then with `timeout` at 5.1 s (`hardened-R9e4.run1.json`, `hardened-R9e4.json`). 8 loops, B failed with `code mode timeout exceeded`, `failurePhase: host`, after 10,107 ms by default and 5,044 ms hardened (`default-R9e.json`, `hardened-R9e.json`). **Severity: high.** One model that fires four parallel `exec` calls with a loop, or four users at once, makes every other investigator's code-mode request fail for the length of the timeout. It repeats for as long as the attacker keeps resubmitting. Mitigation outside OpenClaw: admit at most 3 concurrent `exec` calls per Gateway process and keep `timeoutMs` short.
2. **Host error text reaches the guest and the model, with pattern-based redaction only.** `failing` arrived as `Error: host-tool-boom internal detail db=postgres://user:***@host` (`default-R2b.json`, `hardened-R2b.json`). The bridge settles a failed call with `formatErrorMessage(error)` (`src/agents/code-mode-bridge.ts:557-558`), which only applies `redactSensitiveText` (`src/infra/errors.ts:25-27`). The URL password was masked; the host name, the internal detail and any secret the patterns miss pass through. **Severity: medium.** Tools must throw sanitized errors.
3. **A log flood overruns the timeout and loses its output.** `while(true) console.log("x".repeat(1e6))` ran 12.0 s against the 10 s limit and was stopped by the host-side worker watchdog (`code mode worker timeout exceeded`, `failurePhase: host`). The model got no output. Host memory stayed flat at 381 MB peak (`default-R9c.json`). Hardened, it stopped at 5.8 s with a truncation marker (`hardened-R9c.json`). **Severity: low.**
4. Good: every other aggressor was stopped by its own limit. With up to three concurrent aggressors, neighbors started at most 97 ms late and finished in 326 to 442 ms, against about 210 ms with no aggressor (`verify/neighbor-table.txt`). Prototype pollution and globals did not cross executions (R1, R1c). Functions in tool results were dropped, `Date` became an ISO string and `Map` became `{}` (`default-R2c.json`). A never-settling promise is refused in about 0.25 s with `code mode promise is pending without host work` (`default-R7a.json`). Two thousand parallel calls were rejected with `bridge queue limit exceeded (128 ordinary requests queued; 16 in-flight slots)` before any call was dispatched, so host `started` stayed 0 (`default-R5.json`). Calls fired before a busy loop were never dispatched (`default-R7b.json`). Output is capped with explicit markers: console strings are cut to 512 units with `…[truncated]`, and a 20 MB return became `{truncated, omittedBytes: 20906098, prefix}` (`default-R8a.json`, `default-R8b.json`). Hardened, 16 MiB stopped both outputs as out of memory. Deep recursion and the deep return were caught as `RangeError`, and the next run was fine (`default-R3.json`).

Caveat from the worker's results file, still true: QuickJS is opt-in; the default executor is Node, which is not a security boundary.

## strands-codemode (strands-harness 0.4.0, strands-agents 1.65.0, Monty 0.0.23, `ad1ae00f`)

Adapter `verify/strands-codemode/adapter.py`: `create_harness(...)` with a stub model and `agent.tool.programmatic_tool_caller(code=...)`, as in the worker harness. Shared instance: one Python process. A Strands `Agent` rejects concurrent invocations (`ConcurrencyException`, `strands/tools/_caller.py:102-107`), so a multi-user server holds one agent per conversation, and each execution here gets its own agent. Only `print()` output reaches the model, so the adapter rewrites a trailing bare expression to `print(...)`. Hardened = `{"timeout": 10.0}`, the only public limit.

### Gate reproduction (`verify/strands-codemode/repro/out/`, unchanged copy of the worker's `probe_core.py`, `adapter.py`, `meta.json`)

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | `ModuleNotFoundError: No module named 'urllib.request'` | yes |
| P4 | blocked | `PermissionError: Permission denied: '/etc/hosts'` | yes |
| P5 | blocked | `'os.environ' is not supported in this environment` | yes |
| P6 | limited (60 s VM time) | `TimeoutError: time limit exceeded` at 60.04 s | yes |
| P7 | limited (256 MiB) | `MemoryError ... 269066748 bytes > 268435456` at 0.09 s; tree RSS 326 MB, footprint 294 MB (`P7.watch.json`) | yes |
| P9 | parallel (208 ms) | 201 ms host span, 211 ms wall | yes |
| P12 | blocked (3 of 3) | all three fail (`'tuple' object has no attribute '__class__'`, etc.) | yes |
| H P6 / P7 / P9 | 10 s wall / 256 MiB / 203 ms | 10.00 s / MemoryError at 0.03 s, tree peak 0.32 GB / 202 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Host error text is shown verbatim to the guest and the model, and there is no option to mask it.** The guest received `RuntimeError: Tool 'failing' error: Error: RuntimeError - host-tool-boom internal detail db=postgres://user:pw@host`, both default and hardened (`default-R2b.json`, `hardened-R2b.json`). The Strands tool decorator formats `Error: {type} - {message}` (`strands/tools/decorator.py:675-682`), and the caller re-raises it inside the sandbox (`strands_harness/tools/programmatic_tool_caller.py:138`). **Severity: medium.** Every tool must sanitize its own exceptions.
2. **Long defaults, and nothing caps concurrent executions.** By default the budget is 60 s of VM time, with the clock paused during tool calls, plus a 900 s wall clock (`programmatic_tool_caller.py:47`, `:62`). R6 and R7b ran 60 s, and eight concurrent loops held eight `monty` worker processes at full CPU for 60 s (`default-R9e.json`). Every call creates its own `AsyncMonty()` pool and worker process (`:294`), and the 256 MiB limit is a module constant. Neighbors were still fine on this 14-core machine (≤ +202 ms). **Severity: medium.** Set `timeout` (hardened: all stopped at 10.0 s) and cap concurrent calls in the server.
3. **Non-JSON tool results are converted with `str()`**, so the guest saw `<function rich.<locals>.<lambda> at 0x109536700>` (`default-R2c.json`; `strands/tools/decorator.py:702-707`). **Severity: low** (a host-address leak, as in langchain).
4. Good: the suspension limit fails the program cleanly, and in-flight calls are cancelled. Two thousand gathered calls stopped at 259 ms with `suspension limit 1000 exceeded`; 20 calls started, 10 finished, and the other 10 never completed (`default-R5.json`; hardened: 10 started, 0 done). Concurrency is capped at 10 calls per run (`:51`, `:228`). Output is capped at 200,000 characters with `[output truncated at 200000 characters]` (`default-R8a.json`). `re` is linear (R4: 148 ms). Memory bombs stopped in 43 ms. Nothing crossed executions (R1, R1c). Neighbors were never more than 202 ms late. R7a cannot be expressed: Monty 0.0.23 has no `asyncio.sleep` (`default-R7a.json`). The worker's `timeout_check.txt` shows the worker process ends when the hardened timeout fires.

## bifrost-codemode (maximhq/bifrost:v2.6.0, `172617bb`, Starlark)

Adapter `verify/bifrost-codemode/adapter.mjs`: an MCP client calls Bifrost's own `/mcp` `executeToolCode` with the local virtual key, as in the worker harness. Shared instance: one gateway container (`bifrost-codemode-verify`, 127.0.0.1:42410, `--memory=4g` as in the worker's script), restarted before every test by `verify/bifrost-codemode/start-gateway.sh`. Every execution opens its own MCP session. The host tools are an MCP server inside the test process on 127.0.0.1:42411, so the harness counts every call. Guests are Starlark, so each test is rewritten with the same intent. R4, R7a and R9d have no Starlark form (no regex, no async). The adapter samples the gateway process's VmRSS every 400 ms (`adapterStats` in each record) and kills the container at 4 GB. Hardened = the worker's `data-hardened/config.json` (`max_steps 100000`, `max_memory_bytes 8 MiB`, `max_tool_calls 8`, `tool_execution_timeout 5s`, ...).

### Gate reproduction (`verify/bifrost-codemode/repro/out/`; container `bifrost-codemode-verify-gates`, ports 42412/42413)

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | not-defined | `undefined: urllib`; `load()` fails | yes |
| P4 / P5 | not-defined | `undefined: open` / `undefined: os` | yes |
| P6 | limited (op count, 1M steps, 40 ms) | `too many steps` at 26 ms | yes |
| P7 | limited (op count) | `too many steps` at 3 ms; gateway RSS 275 MB | yes |
| P9 | serial (1,035 ms) | 1,098 ms, 5 calls | yes |
| P12 | blocked | `tuple has no .__class__ field or method`; `__import__` undefined; `dir(probe)` = `[lookup]` | yes |
| H P6 / P7 / P9 | 7 ms / 4 ms / 1,037 ms | 3 ms / 15 ms (247 MB) / 1,035 ms | yes |
| H P3/P4/P5/P12 | as default | as default | yes |

### New findings
1. **Deep recursion is not counted against the memory budget, and concurrent recursions run the gateway out of memory.** The sandbox enables recursion (`core/mcp/codemode/starlark/sandbox.go:170`, `Recursion: true`). It bounds a run by `SetMaxSteps` and `SetMaxAllocs` (`:58-59`), but the interpreter's call stack is not charged to the allocation budget. The R3 recursion got about 110,000 frames deep before `stack overflow` and took the gateway from 240 to 650 MB RSS, which stayed there (`default-R3.json`). Eight concurrent recursions went from 303 to 3,384 MB in about a second and stayed there (`default-R9f.json`). Twelve went from 223 to 4,146 MB in under 0.8 s, at which point my harness killed the container at the 4 GB rule. Every later request failed with `fetch failed` (`default-R9g.json`). With the hardened `max_steps 100000`, recursion stops at about 20,000 frames, and eight concurrent recursions still reached 921 MB (`hardened-R9f.json`). **Severity: critical for a shared deployment.** The code-mode interpreter runs inside the same Go process as Bifrost's LLM gateway, so a dozen recursive scripts, from one model's parallel tool calls or a few users, take down code mode and every proxied model call. Mitigations: a low `max_steps`, a process-wide cap on concurrent `executeToolCode` calls, and a separate gateway instance for code mode. There is no option to turn recursion off.
2. **Host error text is passed to the script and the model verbatim**: `[TOOL] probe.failing returned an error: host-tool-boom internal detail db=postgres://user:pw@host`, plus the same text in the returned `tool_error` struct (`default-R2b.json`, `hardened-R2b.json`). **Severity: medium.**
3. Good, apart from recursion: the step budget stops loops, memory bombs and log floods in 30 to 270 ms, and neighbors were never more than 28 ms late, even under eight loops (`default-R9a/b/c/e.json`). The gateway stayed at 247 to 304 MB through those tests. Tool calls are serial and capped: 64 calls took 13.2 s by default and 8 calls hardened, then `tool call limit exceeded`, with no calls left running (`default-R5.json`). Each run starts from fresh globals (R1, R1c). The guest can see only `dict` methods, the `probe` struct and `json`/`math` (R2a). Large output fails the run on steps rather than truncating it (R8a, R8b), as the worker recorded.
4. Operational: under machine load, one gateway boot failed with `open /app/data/config.db: no such file or directory` (`hardened-R9a.gateway-boot-failed.json`). The start script now retries, and the rerun passed (`hardened-R9a.json`).

## hermes-execute-code (hermes-agent v0.23.3, `caafe538`), hardened Docker backend only

The default local backend fails G1 (rerun below: it read `/etc/hosts`, reached example.com, and ran `os.system`), so the robustness suite ran only with `home-hardened/config.yaml`: Docker backend, `docker_network: false`, 512 MB, 1 CPU, `code_execution.mode: strict`, `timeout: 10`, `max_tool_calls: 50`. Adapter `verify/hermes-execute-code/adapter.py`: `tools.code_execution_tool.execute_code(...)`, as in the worker harness. Shared instance: one Hermes process, with a fresh `task_id` per execution, so each request is a separate conversation with its own container and kernel. In-process patches, as in the worker harness: `lookup`, `failing` and `rich` are registered and added to `SANDBOX_ALLOWED_TOOLS` and `_TOOL_STUBS`, because no public option exposes custom tools to `execute_code`. Container names get the prefix `hermes-execute-code-` for the shared-machine rule, and `docker_cleanup.sh` runs after every test (state saved to `out/hardened-<test>.docker.txt`). The guest is synchronous CPython, so the adapter strips `await`, prints a trailing expression, and uses threads or `time.sleep` for R5, R7a and R7b.

### Gate reproduction (`verify/hermes-execute-code/repro/out/`). Default P6 (300 s) and P7 (no limit, 3.3 GB) were not rerun on the shared machine.

| cell | JSON says | I measured | match |
|---|---|---|---|
| P3 | works (example.com 200) | the SPEC form failed certificate verification; the unverified context got HTTP 200 | yes |
| P4 | works (read /etc/hosts) | `HOSTS 450 chars` | yes |
| P5 | blocked by name | `ENV None` (P5scrub's `ps -E` bypass not rerun) | yes |
| P9 | serial (1,026 ms) | 1,019 ms span | yes |
| P12 | escaped (os.system, popen) | `SUBS 295`, `os.system` → 0 with `PWNED` echoed on the host, `WRAP PWNED2` | yes |
| H P3 | blocked (--network=none) | `Temporary failure in name resolution` | yes |
| H P4 | blocked (container's own /etc/hosts) | 148 chars (the container's file) | yes |
| H P5 | blocked (env empty) | `ENV None` | yes |
| H P6 | limited (10 s; kernel killed) | `Cell timed out after 10s` returned at 11.43 s | yes |
| H P7 | limited (512 MB container OOM), "status error at 1.97 s" | docker `oom_killed=true` (`hardened-docker-state-P7.txt`), but the model saw **status `timeout` at 11.19 s** | outcome yes; detail no |
| H P9 | serial (4,429 ms, file RPC) | 2,443 ms span, 4,984 ms wall | yes |
| H P12 | blocked (ran in container) | all three ran inside the container (`SUBS 240`, `SYSTEM 0`, `PWNED2`) | yes |

### New findings
1. **Raw host error text reaches the model through `tool_errors`, while the guest's own output is redacted.** The guest printed `{'error': '[TOOL_ERROR] Tool execution failed: RuntimeError: host-tool-boom internal detail db=postgres://user:***@host'}`. The JSON the model receives also carries `"tool_errors": [{"tool": "failing", "error": "... postgres://user:pw@host"}]`, unredacted (`hardened-R2b.json`). Output and `error` go through `redact_code_output` (`tools/code_execution_tool.py:516-520`, `:591-592`). `tool_errors` is copied from the RPC call log (`tools/code_execution_rpc.py:113-121`, `:134-142`; `code_execution_tool.py:585-586`) without redaction. **Severity: medium.**
2. **Neighbors are slowed by Docker contention; none failed.** With no aggressor, a request (new container plus kernel) takes about 2 s (R9a `after` 1,955 ms). With a memory bomb, a log flood or eight loops in other conversations, B took 8.0 s, 6.7 s and 11.3 s (`hardened-R9b/c/e.json`). Every aggressor stopped, but 2 to 8.6 s past the 10 s limit (12.0 to 18.6 s). Nothing caps concurrent containers; each conversation gets 1 CPU and 512 MB. **Severity: medium (availability).**
3. **Tool calls are serial over file RPC and slow.** R5 made 30 calls (200 ms each) in the 10 s budget and then timed out. Nothing was left running (`hardened-R5.json`). The P9 gate took 2.4 to 4.4 s for five calls. **Severity: low for safety, high for usability.**
4. **The memory limit is reported as a timeout.** A container OOM appears to the model as `Cell timed out after 10s` after 11 to 17 s (R9b, gate P7), not as a memory error. **Severity: low.**
5. **Configuration is the boundary.** With the default `terminal.backend: local`, the same call runs on the host with file, network and `os.system` access (gate rows above). Custom tools need in-process patches of module globals. **Severity: critical if misconfigured.**
6. Good: every aggressor was stopped (container OOM, 10 s cell timeout). Output is capped at 50,000 bytes head and tail (`model_sees` 50,265 chars for 20 MB, `hardened-R8a.json`; `code_execution_tool.py:47`). No tool call outlived its program (R7b: the five threaded calls finished before the timeout; R5: 30 started, 30 done). Nothing crossed conversations (R1, R1c). Inside the container the guest has full CPython (R2a subclasses walk), but the container has no network, no host mounts and all capabilities dropped. R2c is not meaningful here: a Hermes handler must return a JSON string, so the adapter serialized the rich object itself.

---

## Mismatches against the results files

Every gate cell (P3, P4, P5, P6, P7, P9, P12; default and hardened) for all nine implementations matches on outcome. The results that do not match, or are stale:
- **pi-codemode P7**: "3.5 GB RSS" is one sample. My run stopped at 1.06 GB; earlier runs saw 1.87 and 3.49 GB.
- **asb-quickjs**: the engine text says "fresh module per execution", but the module is now shared. The P7 label "512 MB" is the WASM cap; host RSS per execution reaches 1.68 GB.
- **langchain-quickjs source note** "Errors never raise to the agent": stack overflow raises a wasm `Trap` out of `agent.ainvoke` (R3).
- **utcp-codemode**: the default probes have no `display` field (RUBRIC requires one).
- **Vocabulary**: serial P9 is `limited` in tanstack but `works` in utcp.
- **Second pass, all four**: every rerun gate cell matches on outcome (OpenClaw QuickJS, Strands and Bifrost default and hardened; Hermes default P3/P4/P5/P9/P12 and all hardened cells).
- **hermes-execute-code hardened P7**: the results detail says the model saw status `error` at 1.97 s. The container was OOM-killed again (`oom_killed=true`), but this time the model saw status `timeout` at 11.19 s (`hermes-execute-code/repro/out/hardened-P7.txt`). The robustness memory bomb behaved the same way (R9b, 16.8 s). The outcome word still holds; the detail is not stable.
- **bifrost-codemode G3**: the gate's P7 is a step-limited string loop, so it passes. Deep recursion is a memory path the gate misses: the allocation budget does not see it, and concurrent recursions take the whole gateway process past 4 GB (R9f, R9g above).
- **openclaw-codemode-quickjs-wasi**: P6 says "a concurrent cell returned 42", which is true with one aggressor. With four or more concurrent aggressors, other cells time out (R9e4, R9e).
- P9 timings ran 50 to 150 ms slower than recorded under load average ~45, so they are not comparable across files taken at different times.

## Ranking (shared server, model-written code, sensitive case data), all thirteen

Order: G1 to G3 first, then what one misbehaving program can do to other users (neighbor and host-memory results), then whether host secrets leak into the model, then the RUBRIC tie-breakers.

1. **vercel-ai-sdk-codemode.** Every limit held in every test with defaults: CPU, wall clock including awaits, memory, output and in-flight calls. Neighbors were at most 274 ms late, host errors are replaced by `Host tool failed.`, and host functions resolve strictly. Caveats: worker threads in one process; dispatched calls outlive a failed run unless tools honor the abort signal; `run` is a Labs package.
2. **vercel-run.** The same engine and the same results, used directly when the AI SDK is not wanted.
3. **pydantic-ai-harness-codemode.** A separate worker process, every limit on by default, a call cap with cancellation, linear regex, neighbors ≤ +28 ms. Host exception text must be sanitized before it reaches the sandbox. Guests are limited to a Python subset.
4. **fastmcp-codemode.** The same Monty strengths. Set `mask_error_details=True`. A new worker pool per execute, and the feature is `experimental`.
5. **strands-codemode** (set `timeout`). Monty in a worker process per call: neighbors ≤ +202 ms, a suspension cap that cancels in-flight calls, a 200,000-char output cap with a marker, linear regex. It ranks below fastmcp because host error text goes to the model verbatim with no masking option, the defaults allow 60 s of VM time plus a 900 s wall clock, memory is a fixed 256 MiB constant, and nothing caps concurrent worker processes.
6. **langchain-quickjs.** Good isolation, sanitized errors and a call budget, but the timeout is not enforced during output (10 to 40× overrun), stack overflow fails the agent turn, and it runs in-process under wasmtime.
7. **pi-codemode, hardened only.** Excellent neighbor isolation and output cap once `timeoutMs` and `memoryLimitBytes` are set. You must add your own tool-call cap and error sanitizing.
8. **openclaw-codemode-quickjs-wasi** (`executor: "quickjs"` set explicitly). Isolation, limits, output markers, a call queue that rejects whole programs, and never-settling-promise detection are all good. It ranks here because the shared QuickJS pool has four workers and no option to change that: four busy programs make every other user's request wait or time out (R9e4, R9e). Host errors are only pattern-redacted, and the default executor is Node. Usable behind your own per-process admission limit (at most 3 concurrent `exec`) with a short `timeoutMs`.
9. **hermes-execute-code, hardened Docker only.** The strongest OS boundary here: a container per conversation, no network, all capabilities dropped, 512 MB, and every aggressor was stopped with no neighbor failures. Against it: raw host error text reaches the model in `tool_errors`; neighbors slow from 2 s to 11 s under load; tool calls are serial over file RPC (about 0.37 s per 200 ms call); limits overrun by 1 to 8.6 s; every conversation costs a container start; and custom tools can be exposed only by patching module globals. One config key (`terminal.backend: local`) turns it into host code execution.

**Would not deploy as it stands:**

10. **bifrost-codemode.** Starlark with a step budget isolates well and stopped loops, memory bombs and floods in milliseconds. But recursion is enabled and its stack is not charged to the memory budget: 8 concurrent recursive scripts took the gateway to 3.4 GB and 12 past 4 GB in under a second. The interpreter shares a process with Bifrost's LLM gateway, so that also cuts off every proxied model call. Host error text is verbatim, and calls are serial. Only deployable with a low `max_steps`, a hard cap on concurrent `executeToolCode` calls, and a dedicated gateway instance.
11. **tanstack-ai-codemode-node.** The timeout never fires on awaits, so a never-settling promise or a tool loop runs forever. An unbounded host log buffer took the server to 4.1 GB. No output cap, and errors pass verbatim.
12. **utcp-codemode.** An unbounded host log buffer exceeds 4 GB in under 13 s even with a 64 MB isolate. Error text and HTTP bodies go into the sandbox, tool calls are serial, and the process hangs on exit.
13. **asb-quickjs.** Any CPU-bound guest freezes all users for 60 s. A guest can make the host serialize the entire corpus. A log flood reaches 3.3 GB and crashes `runCode`, and the deadline ignores host-call time. Use the fix list above, or replace the engine with `run`.

## Addendum: asb-quickjs after the rework (coordinator, 2026-11-22)

The sections above describe `src/sandbox.ts` before it was reworked in response to this report. The rework: one Bun worker thread per execution (`src/sandbox-worker.ts`), a host-side 65 s wall clock that terminates the worker, the bridge captured by the prelude and deleted from globals, a `Map` for dispatch, output counted as it is printed and dropped past 8,000 chars, URLs and paths scrubbed from host errors, at most 8 concurrent executions, and `await` removed only outside strings and comments.

The same suite was rerun unchanged (`run-all-robust.sh asb-quickjs`; previous records kept in `asb-quickjs/out-before-worker/`):

| test | before | after |
|---|---|---|
| R9a busy loop, neighbor B | started at +60,021 ms, host lag 60,001 ms | started +152 ms, took 213 ms, host lag 12 ms |
| R9b memory bomb, neighbor | +1,370 ms late | started +153 ms, took 212 ms |
| R9c log flood, neighbor | started at +75,961 ms, host 3.28 GB | started +152 ms, took 212 ms; flood stopped at the 65 s wall clock, peak 1.37 GB |
| R9d slow regex, neighbor | +59,870 ms late | started +154 ms, took 213 ms |
| R9e 8 concurrent loops | harness kill at 120 s | B queued 60 s for a free slot (the 8-way cap), then took 213 ms |
| R5 2,000 serial calls | still running past 110 s | stopped at 65,000 ms by the wall clock |
| A1 `__host("constructor")` | serialized the Corpus | `'__host' is not defined` |
| A4 `"please await  the reply"` | printed `please the reply` | printed unchanged |
| R2b host error with a DSN | verbatim | `host-tool-boom internal detail db=<url>` |

Still true: tool calls are serial (asyncify bridge), the memory cap is per execution (6 concurrent bombs reached 2.27 GB RSS, 3.2 GB footprint), and the engine JIT costs about 1.1 GB once per process.
