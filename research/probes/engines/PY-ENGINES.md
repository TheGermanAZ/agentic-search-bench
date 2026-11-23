# Python code-mode engines: py-monty, py-fastmcp, py-pydantic-ai

Three engines behind the `Engine` interface (`src/engines/types.ts`) where the model writes Python. All three run the program in **Monty** (pydantic-monty 1.6.0, a Rust interpreter for a Python subset) in a separate worker process; they differ in the layer between the host and Monty.

| engine | layer | API the program sees | output that comes back | live answer (truth 458) |
|---|---|---|---|---|
| `py-monty` | pydantic-monty directly | `await count({"from": ...})`, six async functions, positional filter dict | print() streamed and capped, then the final expression | **458**, 2 calls, 4.3 s |
| `py-fastmcp` | FastMCP 4.2.4 `CodeMode` transform, as shipped | `await call_tool("count", {"from": ...})` | the `return` value only; print() is discarded; errors masked | **458**, 2 calls, 4.5 s |
| `py-pydantic-ai` | Pydantic AI Harness 0.71.0 `CodeModeToolset` (`run_code`), no agent | `await count(filter={"from": ...})`, keyword-only, ty type check | print() (sent at the end) then the final expression | **458**, 2 calls, 5.2 s |

Live runs: `pnpm -s ask --strategy=codemode --engine=<name> --model=claude-haiku-5-5 "How many messages did vince.kaminski@enron.com send in April 2001?"`, each answered 458 with first call `count(...)`.

## Shared design

**Files.** `py/` is a uv project (`pyproject.toml`, `uv.lock`, Python 3.12; pins `pydantic-monty==1.6.0`, `fastmcp[code-mode]==4.2.4`, `pydantic-ai-harness[code-mode]==0.71.0`, which resolved `pydantic-ai-slim` 2.71.0, `mcp` 2.3.0). `py/sidecar.py` holds the protocol and the three engine adapters. Node side: `src/engines/py-sidecar.ts` (process manager, shared by all three), `src/engines/py-api.ts` (Python API text and guides), and one module per engine.

**Sidecar and protocol.** Each engine starts one long-lived sidecar: `uv run --quiet --frozen --project py python -I py/sidecar.py <mode>` (`src/engines/py-sidecar.ts:68`) in its own process group (`:73`) with a minimal environment: PATH, HOME, TMPDIR and the `ASB_*` limits only, no API keys (`:56`). JSON lines: Node sends `run`, `result`, `cancel`; the sidecar sends `ready`, `call`, `out`, `done`. The sidecar writes the protocol to a private dup of stdout and points fd 1 at /dev/null before any library loads (`py/sidecar.py:46`), because FastMCP's CodeMode lets Monty print to the host's stdout.

**Contract (src/engines/host.ts), how each point is met:**

| contract | how |
|---|---|
| only the six corpus functions | the only host callables passed to Monty forward to Node's `callCorpus()` (Map lookup, unknown names refused); `py-fastmcp` exposes only `call_tool`, which resolves to those six tools |
| fresh state per execution | `py-monty`: new session on a new worker process (`max_checkouts_per_worker=1`, `py/sidecar.py:156`); `py-fastmcp`: new FastMCP server and new `AsyncMonty()` pool per execution (`code_mode.py:306`); `py-pydantic-ai`: `toolset.for_run(ctx)` per execution (`py/sidecar.py:393`). P8: `fresh` on all three |
| output capped with a marker | prints counted in the sidecar (`Execution.out`, `py/sidecar.py:98`) and in Node's `OutputBuffer`; final value and error text clipped to the remaining room (`clip`, `py/sidecar.py:120`; check in `out/<engine>/caps.txt`) |
| host errors scrubbed | corpus errors pass through `cleanError()` in Node before Python sees them (E1 shows `db=<url>`) |
| ≤ `LIMITS.maxConcurrent` | `slot()` around every execution (`src/engines/py-sidecar.ts:165`); the slot is released only when the sidecar confirms the execution is gone. CONC check: 12 runs of a 200 ms call in 414 to 502 ms |
| guest CPU/duration limit | Monty `max_feed_duration_secs = 60` (`py/sidecar.py:185`, `:296`; harness `max_duration_seconds`, `:373`). It counts sandbox execution only, not time awaiting the host |
| host wall clock 65 s | Node returns `wallClockMessage()`, sends `cancel`; cancelling the task makes Monty kill the worker. If the sidecar does not confirm within 3 s, Node retires it: new runs go to a fresh sidecar, and the old process group is SIGKILLed once every other execution on it has a result (`retire()`/`reap()` in `src/engines/py-sidecar.ts`; before the stall fix below it was killed at once, failing its neighbors). WALL check: stopped at 65.0 s on all three, cancel confirmed, no forced kill, worker replaced |
| memory per execution | Monty `max_memory = 512 MiB`, enforced by the interpreter's own heap accounting inside the worker, not by guest code. No OS limit: macOS does not enforce RLIMIT_AS |
| runaway or crash does not hurt host or neighbors | guest code never runs in Node or in the sidecar. N1 to N3: neighbor 203 to 238 ms on all three. CRASH check: sidecar SIGKILLed mid-loop, in-flight run got an error in about 1 s, no orphan Monty workers (Node kills the group on exit, `:110`), next run respawned it (295 to 961 ms) |
| telemetry off | env set at the top of `py/sidecar.py:20-33` before any import (`FASTMCP_TELEMETRY_MODE=off`, `FASTMCP_CHECK_FOR_UPDATES=off`, `OTEL_SDK_DISABLED`, `LOGFIRE_SEND_TO_LOGFIRE=false`, `DO_NOT_TRACK`). `lsof -i` on every sidecar process group during a run: no inet sockets |

**Pool vs process per execution.** Pool of sidecars (one per engine), fresh Monty worker process per execution. Measured on this machine:

| cost | ms |
|---|---|
| Python + `import pydantic_monty` + pool + first run (`python -c`) | 50 to 60 |
| `import fastmcp, pydantic_ai_harness.code_mode` warm / cold | 480 / 1640 |
| sidecar first run through `uv run` (P1 incl. start): py-monty / py-pydantic-ai / py-fastmcp | 275 / 905 / 987 |
| Monty checkout + run, reused worker | 0.27 (0.4 through Node, P11) |
| Monty checkout + run, fresh worker, 50 ms between runs (pre-spawned) | 0.65 |
| Monty checkout + run, fresh worker, back to back (P11, refill lags) | 5.9 median, 6.3 p90 |

A sidecar per execution would add 50 to 1000 ms to every call; a fresh Monty worker per execution costs under 1 ms when calls are seconds apart (an LLM turn) and about 6 ms back to back, so every execution still gets its own OS process. The sidecar is shared, so a sidecar crash fails every execution in flight on it; it holds no guest code, and the only forced kill is the 3 s cancel grace, which never fired in testing.

## py-monty

`MontyEngine` (`py/sidecar.py:133`). `AsyncMonty(max_processes=LIMITS.maxConcurrent, min_processes=2, max_checkouts_per_worker=1, request_timeout=65)` (`:153-158`); per execution `pool.checkout(limits={"max_memory": 512 MiB, "max_feed_duration_secs": 60})` and `session.feed_run(code, external_lookup=<six async functions>, print_callback=...)` (`:185-192`). The six functions take the JS arguments, filter dict first; keyword arguments merge into it with `from_` for `from` (`merge`, `:131`). Errors: `MontyRuntimeError.display("traceback")`.

Options and evidence (`py/.venv/lib/python3.12/site-packages/pydantic_monty/`): `_monty.pyi:1074-1083` AsyncMonty pool options (`min_processes`, `request_timeout`, `max_checkouts_per_worker`; "`0` and `1` both run every session in a fresh process", `:746`); `_monty.pyi:1302-1320` `feed_run(external_lookup, print_callback)`; `__init__.py:142-181` `ResourceLimits` (duration clock "runs only while sandboxed code executes, never while suspended waiting on the host").

## py-fastmcp

`FastMCPEngine` (`py/sidecar.py:210`). Per execution: `FastMCP("corpus", mask_error_details=True)` (`:231`) with six function tools whose parameters mirror the JS options flat, `from` via `Field(alias="from")` (`:244`); tools raise `ToolError` with the scrubbed message so tool errors are not masked. `CodeMode(sandbox_provider=MontySandboxProvider(limits={max_memory 512 MiB, max_feed_duration_secs 60}), discovery_tools=[])` (`:296-298`), then `Client(server).call_tool("execute", {"code": ...}, raise_on_error=False)` (`:306`). Discovery tools are dropped because the model gets the catalog in `apiDoc` and only ever calls `execute`; `max_tool_calls` (50) and `wall_clock_timeout_secs` (None) left as shipped.

As shipped, from `fastmcp/experimental/transforms/code_mode.py`: the program sees only `call_tool(tool_name, params)` (`:690-694`, "Use `return` to produce output"); results are the tool's structured content (`_unwrap_tool_result`, `:116`), so non-object results arrive wrapped as `{"result": ...}` (count, search, messages, people, read) while grep's object arrives bare; `max_tool_calls=50` (`:635`); a new `AsyncMonty()` pool per execution with no `print_callback` (`:306-313`), so print() goes to the host's stdout; baseline limits 30 s and 100 MB (`:167-170`), overridden here. Masking: `fastmcp/server/server.py:1736-1738` replaces any non-`ToolError` exception with `Error calling tool 'execute'`.

## py-pydantic-ai

**Can the code-execution layer be called without an agent? Yes**, through public classes, so it is wired like the others. `CodeModeToolset` is an ordinary toolset: `call_tool(name, args, ctx, tool)` (`pydantic_ai_harness/code_mode/_toolset.py:1244`) needs a `RunContext` whose `tool_manager` is set (`:1410`), because nested calls go through the standard `ToolManager` path. `PydanticAIEngine` (`py/sidecar.py:319`) builds per execution `RunContext(deps=<execution>, model=TestModel(), usage=RunUsage())` (`:392`), `toolset.for_run(ctx)` (`:393`), `ToolManager(toolset, root_capability=CombinedCapability([])).for_run_step(ctx)` (`:395`), and sends one `ToolCallPart("run_code", {"code": ...})` through `ToolManager.handle_call` (`:399`), the same call the agent graph makes. The `TestModel` only fills a required field; it is never called. `ToolRetryError` text (what a model would get as a retry prompt) becomes the error. The six tools are `FunctionToolset` functions taking `RunContext[Execution]` with TypedDict filters (`:347-370`); limits `resource_limits={"max_duration_seconds": 60, "max_memory": 512 MiB}` (`:373`).

As shipped, from `pydantic_ai_harness/`: positional arguments are refused, "`{name}() does not accept positional arguments; use keyword arguments`" (`_monty_exec.py:584`), so this engine cannot take the filter dict positionally and its API is `count(filter={...})`; the first snippet of a REPL is type-checked with ty against stubs built from the tool schemas (`code_mode/_toolset.py:1431`), so `read()`'s `dict | None` must be checked before indexing; `max_tool_calls=100` (`:916`); defaults 30 s and 256 MiB (`:374`), overridden here; prints captured up to 10 MiB per feed (`_monty_exec.py:271`) and returned at the end, not streamed.

## Probe results

Shared harness: `research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/run.ts --engine=<name>`. Forms: `forms/python.json` (SPEC Python column; `read(id)` is the `lookup` stand-in; FLOOD is an endless print loop), overrides `forms/py-fastmcp.json` (call_tool, `return`; P3 to P5 and P12 wrapped in try/return because uncaught errors are masked) and `forms/py-pydantic-ai.json` (keyword arguments; P3, P8b, P12 carry `# type: ignore` so they reach Monty's runtime; the plain forms, stopped by ty, are kept in `out/py-pydantic-ai/typecheck-on/`). Evidence in `out/<engine>/`; extra checks `py-extra.ts` (`extra.txt`) and `py-caps.ts` (`caps.txt`).

| probe | py-monty | py-fastmcp | py-pydantic-ai |
|---|---|---|---|
| P1 tool call | works: 42, 1 call | works: 42, 1 call | works: 42, 1 call |
| P2 output | works: 8000 A + marker, then RETURNED | limited: RETURNED only, print discarded | works: 8000 A + marker, then RETURNED |
| P3 network | not-defined: no module `urllib` | not-defined | not-defined (ty rejects the import first) |
| P4 files | blocked: PermissionError `/etc/hosts` | blocked | blocked |
| P5 env | blocked: `os.environ` not supported | blocked | blocked |
| P6 loop | limited: TimeoutError at 60.0 s | limited at 60.0 s, but model sees only `Error calling tool 'execute'` | limited at 60.0 s, with reset advice |
| P7 memory | limited: MemoryError 537,115,258 > 536,870,912 B in 48 ms | limited (MemoryError in server log), masked | limited: MemoryError in 144 ms |
| P8 state | fresh | fresh | fresh (plain form: ty error) |
| P9 parallel | parallel: 231 ms for 5 × 200 ms | parallel: 226 ms | parallel: 237 ms |
| P10 errors | works: traceback, line 1, `ValueError: probe-boom` | masked: `Error calling tool 'execute'` only | works: traceback, line 1 |
| P11 startup | 5.9 ms median, 6.3 p90 | 17.0 / 17.9 ms | 17.6 / 18.6 ms |
| P12 escape | blocked (`__class__` AttributeError, `__import__` NameError, `globals` NameError) | blocked (same) | blocked (ty first; at runtime the same) |
| E1 host error | caught, `db=<url>` scrubbed | caught, `call_tool('search') failed: ... db=<url>` | caught, scrubbed |
| N1 neighbor vs loop | 204 ms | 220 ms | 221 ms |
| N2 neighbor vs memory | 204 ms | 238 ms | 221 ms |
| N3 neighbor vs print flood | 203 ms | 227 ms | 221 ms |
| WALL (65 s host clock) | stopped at 65.0 s, worker replaced | stopped at 65.0 s | stopped at 65.0 s |
| CRASH (sidecar SIGKILL) | error in 1.0 s, no orphans, respawn 295 ms | same, respawn 961 ms | same, respawn 716 ms |

Peak tree RSS stayed 160 to 245 MB in every probe; the 200 ms sampler missed P7's peak (the limit fired within 48 to 144 ms).

## What did not work, or works differently

- **FastMCP masking hides the model's own errors.** With `mask_error_details=True` (as asked), every uncaught guest exception, including syntax errors, the 60 s limit and the memory limit, reaches the model as `Error calling tool 'execute'`; the real cause is only in the sidecar's stderr log (MASK check in `out/py-fastmcp/extra.txt`). The guide tells the model to wrap code in try/except and return the error text itself.
- **FastMCP discards print().** CodeMode passes no `print_callback`; only the returned value comes back. `src/strategies.ts:113` (not mine to edit) describes the execute tool as "return what it prints" and "Print the results you need to see" for every engine, which is wrong for `py-fastmcp`; the engine guide overrides it, and Haiku used `return` correctly.
- **FastMCP wraps non-object results** as `{"result": ...}`; documented per tool in apiDoc.
- **Pydantic AI Harness refuses positional arguments**, so the requested `count({"from": ...})` form is impossible there; the API is `count(filter={...})`. Its ty pre-check also rejects some valid programs (for example indexing `read()`'s result without a None check).
- **Pydantic AI Harness puts all output printed before an error into the error text** (up to its 10 MiB cap). Final values and errors from all three engines also bypassed the output cap, because `OutputBuffer.finish(tail)` (`src/engines/host.ts`) appends the tail unchecked: a 200,000-char final expression came back whole. Fixed for the py-* engines by clipping in the sidecar (`out/<engine>/caps.txt`: 8,034 to 9,085 chars back). The same unchecked tail exists for the JavaScript engines that pass a value to `finish()`.
- **The Pydantic AI wiring relies on harness internals staying stable**: a `RunContext` with a placeholder model and a hand-built `ToolManager`/`CombinedCapability`. All public classes, but not a documented entry point, so a harness upgrade can break it.
- **Memory is Monty's heap accounting, not an OS limit.** No RLIMIT on macOS; a bug in Monty's accounting would not be caught by the OS.
- The full probe suite ran before the output clipping fix and before two crash-path tweaks in `py-sidecar.ts` (per-process pending map, group kill on exit); `py-extra.ts` and `py-caps.ts` ran after them.

## Stall investigation (2026-11-22)

**Symptom.** With four agents at once (`--only=hrd-01,hrd-04,hrd-07,hrd-09 --concurrency=4`), a py-pydantic-ai execution that normally takes 4 to 15 s returned the 65 s wall-clock error after 67 to 109 s. Agents whose executes took 10 s finished at 125 s, and sometimes a later execution failed with `python sidecar exited on SIGKILL`. Seen in 3 of 5 runs on py-pydantic-ai and once on py-monty.

**Root cause: `Corpus.grep` ran ripgrep with `spawnSync`, which blocks Node's event loop for each 3.5 to 5 s whole-corpus scan.** In the bad run (`runs/engines-hard-pa3`), hrd-07's first program was `asyncio.gather` over 31 one-day `grep("dynegy", ...)` calls. The sidecar sent all 31 `call` lines within 5 ms. Node read them from the pipe and ran 31 synchronous scans back to back: about 31 × 3.5 s ≈ 109 s with no timers, no pipe reads and no Agent SDK traffic for anyone. The Python side was never the bottleneck. The rest followed from that:
- (1) The 65 s wall timer could only fire after the stall, so 108,888 ms.
- (2) The other agents' finished tool results sat unread in their pipes. Node's event loop runs expired timers *before* pending I/O in each turn, so a `done` that arrived during the stall lost to the late wall timer. Runs that had really finished were reported as timeouts.
- (3) A wall-clocked execution's queued `call` lines still ran their synchronous scans after the cancel was sent. They blocked for more than the 3 s cancel grace, the kill timer fired before the sidecar's `done` was read, and `kill(proc)` SIGKILLed the whole process group. That took down every execution on the sidecar.

The engine does not matter: the stall is in the shared host path. py-monty hits it whenever a program fans out greps. A replay reproduces the stall only if it includes a fan-out like hrd-07's 31-way gather. A single-grep program blocks for one scan at most.

**Evidence** (temporary tracing: the sidecar stamped each message with its send time, and Node logged receive time, corpus call duration and wall-timer lateness. Replay without the agent: `stall-replay.ts`, below).
- Before the fix, py-pydantic-ai:
  - The loop monitor saw one 125,029 ms stall.
  - `pipe_lag` grew by about 3.5 s per `call` line: 0, 3.2, 7.2, 7.7, 11.5 … 78 s.
  - Each corpus grep "took" 4 to 50 s, a `count()` "took" 121,023 ms, and every wall timer fired 63,269 ms late.
  - hrd-09's `done`, sent by Python at +8.1 s, was read at +133 s (pipe lag 125,076 ms) and reported as a 65 s timeout.
  - Total 133 s.
- Before the fix, quickjs-asyncify with the same programs in JS: repeated 3.4 to 8.6 s stalls, and neighbors waited 21.6 s.
- rg alone on this machine (500k files, 1.2 GB): one scan 3.5 s, two concurrent 15.5 s, four concurrent 18.9 s. It is kernel-bound (sys time 15 s for one, 221 s for four). So an async spawn alone would have made the 31-way gather slower.

**Fix.**
- `src/search.ts`: `Corpus.grep` is async and spawns rg without blocking.
  - Concurrent greps for the same pattern and case flag share one in-flight scan. Filters and `limit` are applied per caller afterwards, as before.
  - Scans run one at a time (`RG_MAX_CONCURRENT = 1`, from the measurements above).
  - Callers updated: `CORPUS_FUNCTIONS` already awaited, and the tools strategy now awaits (`src/strategies.ts`).
- `src/engines/py-sidecar.ts`:
  - (a) `call` lines from an execution that already has its result are refused instead of starting host work.
  - (b) The wall and cancel-grace timers decide in a `setImmediate` after the timer, which runs after pending I/O. A reply that arrived during any stall wins over a late timer.
  - (c) An unconfirmed cancel no longer kills the sidecar. `retire()` sends new runs to a fresh sidecar, and `reap()` kills the old process group only when every other execution on it has a result. Each of them still has its own wall clock, so the retired process lives at most about 65 s longer.
- Unrelated, to make `pnpm typecheck` pass: a type-only fix to `liveCells` in `src/compare-engines.ts`.

**Results unchanged.** The old `spawnSync` code was copied verbatim into a comparison script and run against the new `grep`. Eight cases matched (totals, hits and rg's error text for `(`): the four hard-question patterns, `from`/`to`/`caseSensitive` filters, a phrase, an invalid regex, and two greps sharing one scan against two separate calls. One caveat predates this change: when `limit` is below the match count, *which* hits come back depends on rg's multithreaded output order. Two runs of the old code returned different hits.

**Verification.**

- **Replay without the agent** (`pnpm exec tsx research/probes/engines/stall-replay.ts py-pydantic-ai`, same five programs): total 14.7 s instead of 133 s. hrd-07's 31 greps shared one scan and finished in 11.2 s. No wall timer fired. The longest event-loop gap was 1.4 s, and it was not grep: the `Corpus` constructor blocks for about 2 s once, and a cold first SQLite `count()` or `search()` can block for 0.5 to 2.5 s. Those were already there, and the `setImmediate` deferral keeps them from turning a finished run into a timeout.
- **Retire path** (`stall-retire.ts`, which drops one execution's `cancel` so it never confirms). Results on py-pydantic-ai, then py-monty:
  - The runaway A was wall-clocked at 2.4 / 2.1 s.
  - At A's 3 s cancel grace the sidecar was retired, not killed.
  - A new run C went to a fresh sidecar (`spawns=2`).
  - Neighbor B, an 8 s host call on the old sidecar, returned `42` normally.
  - Only then was the old process group killed (old pid gone 0.5 s after B).
  - Before the fix, B would have failed with `sidecar exited on SIGKILL`.
- **Agent repro**, `TRACE_EXECUTE=1 pnpm -s bench ... --only=hrd-01,hrd-04,hrd-07,hrd-09 --concurrency=4`, runs `stallfix-pa1..3` on py-pydantic-ai and `stallfix-monty1` on py-monty:

  | run | result | longest execute | question latencies |
  |---|---|---|---|
  | stallfix-pa1 | 4/4 | 13.5 s (hrd-07's 31-way gather) | 11.8 to 23.7 s |
  | stallfix-pa2 | 4/4 | 14.9 s | 10.3 to 18.7 s |
  | stallfix-pa3 | 4/4 | 13.7 s (31-way gather) | 13.4 to 23.3 s |
  | stallfix-monty1 | 4/4 | 11.2 s | 7.6 to 23.6 s |

  No execute over 30 s, no wall-clock errors, no sidecar exits. Before the fix: 120 to 225 s per question in bad runs.
- **Probes** (`research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/run.ts --engine=<e> --only=P1,P6,P7,P9,N1,N2`):
  - All three engines (py-pydantic-ai, quickjs-asyncify, vercel-run) ran with no regressions. P6 stopped at 60.0 s and P7 hit the memory limit in 73 ms to 1.4 s.
  - N1 and N2 neighbors printed in 221 to 259 ms.
  - P9: 223 ms on py-pydantic-ai and vercel-run; 1,072 ms on quickjs-asyncify, whose per-engine form calls `read` synchronously (5 × 200 ms).
  - `pnpm typecheck` passes.
