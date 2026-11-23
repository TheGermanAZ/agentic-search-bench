# JavaScript code-mode engines: vercel-run, quickjs-ng, isolated-vm

Three engines behind `src/engines/types.ts`, beside the baseline `quickjs-asyncify`. All follow the host contract in
`src/engines/host.ts`: only the six corpus functions are reachable, through `callCorpus`; fresh state per execution;
output capped by `OutputBuffer` with a marker; host errors scrubbed with `cleanError`; at most `LIMITS.maxConcurrent`
executions via `slot()`; guest CPU limit (60 s) plus host wall clock (65 s); a 512 MB memory cap enforced by the engine.

All three use an async bridge: every corpus function returns a Promise, so `await Promise.all([...])` overlaps calls,
and the model gets `jsGuide(true)` / `corpusApi(true)`. All three run the model's program as the body of an async
function (`src/engines/js-wrap.ts`): top-level `await` works, `return x` prints `x`, and guest stack lines are mapped
back to the model's own line numbers. Unlike the baseline, a bare last expression is not printed (P2 prints only the
`console.log`). `js-wrap.ts` also holds a host-side gate per execution: at most 16 corpus calls run at once (more wait
in line) and 10,000 in total.

Pinned: `run` 2.1.13, `@jitl/quickjs-ng-wasmfile-release-sync` 0.32.0 (quickjs-ng 0.12.1), `isolated-vm` 7.0.2
(native add-on, built through `pnpm.onlyBuiltDependencies`; loads under Node 24.22.1 and tsx).

Rerun: `research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/run.ts --engine=<name>` (SPEC probes and
neighbor tests) and `research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/js-extra.ts --engine=<name>`
(extra probes X1-X9 below). Outputs: `research/probes/engines/out/<name>/`. No engine needed its own probe form.

## Results

| Probe | vercel-run | quickjs-ng | isolated-vm |
|---|---|---|---|
| P1 tool call | works, 42, 1 call | works, 42, 1 call | works, 42, 1 call |
| P2 output | 8000 chars + `[output truncated: 192001 more chars]`; return value not printed (no `return`) | same | same |
| P3 network | not-defined (`fetch`) | not-defined | not-defined |
| P4 filesystem | not-defined (`require`) | not-defined | not-defined |
| P5 env | not-defined (`no process`) | not-defined | not-defined |
| P6 busy loop | limited: CPU limit at 60,014 ms | limited: 60,057 ms | limited: 60,008 ms |
| P7 memory | limited: catchable `InternalError: out of memory` at 1.5 s, peak tree RSS 698 MB | limited: catchable OOM at 1.3 s, peak 601 MB | limited: isolate disposed at 1.5 s, peak 690 MB |
| P8 state | fresh | fresh | fresh |
| P9 parallel | parallel, 222 ms, 5 calls | parallel, 201 ms | parallel, 221 ms |
| P10 errors | `Error: probe-boom` + `at <anonymous> (line 1:11)` | same | `Error: probe-boom` + `at line 1:7` |
| P11 startup | median 3.9 ms, p90 4.6 ms | median 56.1 ms, p90 64.8 ms (worker per run) | median 0.9 ms, p90 1.2 ms |
| P12 escape | blocked: `Function constructor is not allowed`; `this.process` undefined | blocked: Function works, no `process` | blocked: Function works, no `process` |
| E1 host error | `host-tool-boom internal detail db=<url>` | same | same |
| N1 neighbor vs P6 | 251 ms | 263 ms | 202 ms |
| N2 neighbor vs P7 | 254 ms | 271 ms | 203 ms |
| N3 neighbor vs log flood | 206 ms | 260 ms | 202 ms |
| FLOOD output kept | no: CPU stop loses the guest-side buffer, only the error returns | yes, 8000 chars + error | yes, 8000 chars + error |

Extra probes (`js-extra.ts`, outputs `out/<name>/X*.txt`):

| Probe | vercel-run | quickjs-ng | isolated-vm |
|---|---|---|---|
| X1 64 MB Uint8Arrays in a loop | OOM, peak 405 MB | OOM, peak 285 MB | `Array buffer allocation failed` |
| X2 WebAssembly.Memory growth | not-defined | not-defined | **grew to 3.5 GB (host RSS 2,815 MB) before the fix**; now not-defined |
| X3 `return "x".repeat(3e8)` | 8000 chars + marker | 8000 chars + marker | 8000 chars + marker, host RSS 51 MB |
| X4 200 MB corpus argument | guest OOM while serializing (Run caps arguments at 1 MiB) | guest OOM while serializing (worker caps at 1 MiB) | `corpus call arguments are too large` |
| X5 20,000 unawaited calls | run fails: "ended while corpus calls were still running" (16 calls ran) | 10,000 calls run, rest error | 10,000 calls run, rest error |
| X6 `Promise.all` of 100 reads | 1,411 ms (16 at a time) | 1,407 ms | 1,406 ms |
| X7 patched `String.prototype.slice`, `Array.prototype.join` | output still capped (8050 chars) | capped | capped |
| X8 syntax error | `SyntaxError: variable name expected` (no line) | `SyntaxError ... at line 2:7` | `SyntaxError: Unexpected token '=' [line 2:7]` |
| X9 `await new Promise(() => {})` | waits for the 65 s wall clock | detected at once | waits for the 65 s wall clock |

Live question ("How many messages did vince.kaminski@enron.com send in April 2001?", truth 458, claude-haiku-5-5):
see the end of this file.

## vercel-run (`src/engines/vercel-run.ts`)

Design. One `createRunner` per process; each execution calls `runner.run({ source, hostFunctions, abortSignal })`.
Run gives a fresh QuickJS context per run in a pooled worker thread. The six corpus functions are one host-function
group `__corpus`, each taking and returning JSON text through `corpusGate` → `callCorpus`. The prelude captures the
group, deletes the global, and defines `corpus` with async wrappers that throw on `{__error}` and queue beyond 16
calls in flight. The host wall clock aborts the run through `abortSignal` (Run then destroys the worker) and races
it, holding the slot up to 5 s more until Run releases its invocation.

Options (`node_modules/run/dist/index.d.ts`):

| Option | Value | Evidence |
|---|---|---|
| `timeoutMs` | 65,000 (`LIMITS.wallMs`) | index.d.ts:133 |
| `cpuTimeoutMs` | 60,000 (`LIMITS.cpuMs`); measures elapsed time while guest code runs, not thread CPU | index.d.ts:134-148 |
| `memoryLimitBytes` | 512 MiB, passed to the QuickJS runtime | index.d.ts:150; worker-source.js `memoryLimit:t.memoryLimitBytes` (single-line file, offset ~942355) |
| `maxInFlightBridgeRequests` | 32 (guest queue is 16); exceeding it fails the run, it does not queue | index.d.ts:166; manager.js:789-799 |
| `maxBridgeRequests` | 10,000 | index.d.ts:164; manager.js:536-545 |
| `maxHostFunctionOutputBytes` | 16 MiB (default 4 MiB) | index.d.ts:162 |
| `maxHostFunctionArgumentsBytes` | default 1 MiB | index.d.ts:160 |
| `maxResultBytes` | 256 KiB (the guest returns `{text, dropped, value|error}`) | index.d.ts:154 |
| `maxConsoleOutputBytes` | 1 byte (Run's console is shadowed; see below) | index.d.ts:156 |
| `setMaxWorkers` | `LIMITS.maxConcurrent` | index.d.ts:386; max-workers.js:23-49 |

Findings:
- Run's `console` writes with `writeSync` to the host process's fd 1/2 (worker-source.js, `function ar(` near offset
  942998) and never reaches the caller. `globalThis.console` is non-writable and non-configurable, so the prelude
  declares a lexical `const console` in the scope around the model's code. It keeps the first 8,000 characters inside
  the guest and returns them with the result. On an uncatchable stop (CPU limit, wall clock) that buffer is lost, so
  the FLOOD probe returns only the error.
- Without `setMaxWorkers`, Run admits workers by free memory (`availableMemory / (memoryLimitBytes + 48 MB)`,
  max-workers.js:30-33) and throws `RunConcurrencyError` instead of queueing (manager.js:291, 298). At 512 MB per run
  that can refuse work below our 8 slots, so the engine sets the cap to match `slot()`.
- The replay ledger, which keeps every host result in host memory, is recorded only when continuations are enabled
  (manager.js:880, 919; run.js:185). We pass no continuation secret or codec, so a high `maxBridgeRequests` does not
  grow host memory.
- A program that returns while a corpus call is unawaited fails with `RUN_DETACHED_BRIDGE_REQUEST` (X5); the engine
  turns that into "Await every corpus call".
- `Date` and `Math.random` are deterministic in the guest (for replay), though `Date.now()` advances across awaits.
  Run copies `process.env` into its worker (manager.js:1477); the guest cannot read it (P5).

## quickjs-ng (`src/engines/quickjs-ng.ts`, `src/engines/quickjs-ng-worker.ts`)

Design. Same shape as the baseline: a fresh worker thread per execution, the WASM module compiled once and passed in.
In the worker, `newVariant(ng, { wasmModule, wasmMemory })` and `newQuickJSWASMModuleFromVariant`. `__host(name,
args)` returns `vm.newPromise().handle` (quickjs-emscripten-core index.d.ts:1158); the worker posts the call to the
host, and on the reply resolves the deferred, runs `vm.runtime.executePendingJobs()` (index.d.ts:310) and checks the
program's promise with `vm.getPromiseState` (index.d.ts:1357). The program is `(async () => {\n<code>\n})()`.
Output is counted and capped in the worker as it is produced and streamed to the host's `OutputBuffer`. The worker,
which is trusted, also caps what it forwards: corpus arguments at 1 MiB, the return value at 8,000 characters, error
text at 4,000.

- Memory: `setMemoryLimit` (index.d.ts:315) is still not enforced in the ng build.
  `out/quickjs-ng/setMemoryLimit-check.txt` (script beside it): with `setMemoryLimit(64 MB)` the runtime reports
  `malloc limit: 67108864` and `malloc_usable_size unavailable`, then allocates 2,141 MB before `out of memory`. The
  ng and asyncify WASM files both import their memory (`WebAssembly.Module.imports` shows `a.a` of kind memory), so
  the cap is a `WebAssembly.Memory` with `maximum = 512 MiB / 64 KiB` pages passed as `wasmMemory`
  (quickjs-ffi-types index.d.ts:252). P7 hits a catchable OOM at 1.3 s.
- CPU: `setInterruptHandler` (index.d.ts:287) counts only time spent inside `evalCode`/`executePendingJobs`, so
  waiting for corpus calls does not use the 60 s. The interrupt is uncatchable in the guest; the worker reports it as
  the CPU limit. The host wall clock terminates the worker.
- A program waiting on a promise that nothing can settle (no corpus call pending, no jobs) is reported at once (X9).

## isolated-vm (`src/engines/isolated-vm.ts`)

Design. A new `ivm.Isolate({ memoryLimit: 512 })` and context per execution, on the main thread. The isolate runs on
isolated-vm's own thread pool through the async API only (`compileScript`, `script.run(ctx, { promise: true })`), so a
busy guest does not block the event loop: N1 shows the neighbor at 202 ms. A worker thread would add nothing here, and
it would not contain a native crash of the add-on, which takes the whole process down either way. The host polls
`isolate.cpuTime` (isolated-vm.d.ts:41) every 20 ms and disposes the isolate past 60 s; a 65 s timer disposes it for
the wall clock.

Bridge. The guest never holds a host object or an `ivm.Reference`. A Reference handed to the guest exposes `.get()` and
`.apply()` on host objects. A program that patches `Reference.prototype.apply`, or sets `Object.prototype.reference =
true` so isolated-vm hands back references, could walk to the host's `Function`. Instead:
- `__start(id, name, argsJson)` and `__log(text, dropped)` are `ivm.Callback`s (isolated-vm.d.ts:562), plain
  functions in the guest whose arguments are always copied. `__log` is synchronous, so a printing loop waits for the
  host rather than queueing messages without bound.
- An async Callback cannot return a promise (`#<Promise> could not be cloned`), so results come back the other way:
  before the model's code runs, the host takes a Reference to a guest-side resolver (`__resolve`), deletes the global,
  and calls it with the copied JSON when `callCorpus` finishes.
- The prelude captures `Reflect.apply`, `String.prototype.slice`, `JSON`, `Promise.prototype.then` and the `Map`
  methods before the model's code runs. Patching them later (X7) cannot enlarge what crosses to the host: printed
  text is cut to the remaining room, arguments to 1 MiB, error text to 4,000 characters. The program's return value
  is printed through the same path, never copied out as a result.

Options: `memoryLimit` 512 (isolated-vm.d.ts:137), `onCatastrophicError` (isolated-vm.d.ts:157) is recorded and
reported. The `timeout` run option (isolated-vm.d.ts:704) is not used, since `cpuTime` polling covers time spent after
an await too.

## What did not work

- vercel-run: replacing `globalThis.console` (non-writable). A sync host function for logging was possible
  (`syncHostFunctions`) but each call counts toward `maxBridgeRequests` and allocates a shared bridge buffer sized by
  the host-function byte limits; the guest-side buffer was simpler.
- vercel-run: a bare last expression returns nothing in function-body mode (same rule now in all three engines).
- quickjs-ng: importing constants from the worker module into the host ran the worker's top-level code on the main
  thread (`parentPort` is null); the host now passes the file name in the run message.
- isolated-vm: `new ivm.Callback(asyncFn, { async: true })` cannot return a promise to the guest.
- isolated-vm: before the fix, `WebAssembly.Memory` grew to 3.5 GB outside the 512 MB heap limit (X2, host RSS
  2,815 MB). The prelude now deletes `WebAssembly`.

## Limits accepted but not enforced

- QuickJS `setMemoryLimit` in the quickjs-emscripten builds (both ng and asyncify): accepted, reported, not enforced.
  Not used; the WebAssembly memory maximum is the cap.
- isolated-vm `memoryLimit` counts the V8 heap and ArrayBuffers (X1) but not WebAssembly memory (X2); its own docs
  call it "a guideline ... a determined attacker could use 2-3 times this limit" (isolated-vm.d.ts:132-136). P7 peaked
  at 690 MB of host RSS.
- Run `cpuTimeoutMs` is elapsed time while guest code runs, not thread CPU time (index.d.ts:134-148).
- Run `maxInFlightBridgeRequests` fails the run instead of queueing; the guest-side queue of 16 keeps the model's
  `Promise.all` under it (X6), but the queue itself lives in the guest.
- vercel-run and isolated-vm do not detect a promise that will never settle; such a program costs the full 65 s (X9).
- vercel-run syntax errors lose their line number after wrapping (X8).

## Live question

`pnpm -s ask --strategy=codemode --engine=<name> --model=claude-haiku-5-5 "How many messages did vince.kaminski@enron.com send in April 2001?"`
(truth 458). Transcripts: `out/live/<name>.txt`.

| Engine | Answer | Time | Tool calls | Input tokens |
|---|---|---|---|---|
| vercel-run | 458 | 5.2 s | 2 | 8,158 |
| quickjs-ng | 458 | 4.3 s | 2 | 8,093 |
| isolated-vm | 458 | 4.7 s | 2 | 8,132 |

In each run the model used `await corpus.count(...)` and then `await corpus.messages(...)` to check the sender.
