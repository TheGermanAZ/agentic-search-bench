## What the comparison shows

85 rows. 69 were probed hands-on on this machine with the same twelve probes, each with its project's defaults and, for the 56 that expose stricter settings, again with the strictest ones (`RUBRIC.md`). No model was in the loop except for Claude Code's Code Mode, which only runs interactively, so Haiku typed the fixed probe code and a hook substituted it when Haiku refused. 10 could not be run: hosted services that need an account, two adapters that are empty stubs, and two backends that crash on setup. 5 rows come only from documentation. Then an independent reviewer, in two separate runs, reran the gate probes for 13 candidates and added tests the probes do not cover, the ones a shared server cares about: does one user's runaway program delay or break another user's request, does a log flood grow host memory, does a timeout hold across `await`, does host error text reach the model (`verify/REPORT.md`). Every gate outcome it reran matched; two details did not (Pi's peak memory on P7, the error text Hermes returns at its memory limit), and Hermes's default P6 and P7 were not rerun.

### The answer

Three gates decide eligibility: G1 isolation (no files, environment, network or escape), G2 a time limit of the implementation's own, and G3 a per-execution memory limit that leaves the host alive. Gates come from the twelve probes, downgraded where the independent check showed the same limit failing under a variant (Bifrost's memory budget, TanStack Node's timeout across `await`) or where a limit freezes the host while it waits. 11 of 69 pass all three with their defaults; 15 with their strictest settings.

- **TypeScript: Vercel AI SDK Code Mode** (`@ai-sdk/code-mode`), or **Vercel Run** (`run`), the engine under it, when you are not on the AI SDK. QuickJS in WebAssembly, in a worker thread. Defaults held every limit (10 s CPU, 30 s wall, 64 MiB), tool calls run in parallel, other users' requests were delayed at most about 0.3 s while a neighbor misbehaved, and host errors reach the model only as a generic message. By default every tool's signature goes in the prompt; an optional mode defers tools to tool search for large catalogs. Weak spots: `console.log` goes to the host's stdout, not to the model, so programs must return their result; the 33rd concurrent tool call fails the run while the 32 already sent keep running unless the tool honors the abort signal.
- **Python: Pydantic AI Harness CodeMode**, or **FastMCP CodeMode** when the tools are an MCP server. Both run Pydantic's Monty interpreter in a separate worker process with 30 s and 100 MB (FastMCP) or 256 MiB (Pydantic AI) on by default, parallel tool calls, and a tool-call cap. Both pass host error text to the model unless you mask it (`mask_error_details=True` in FastMCP; your own wrapper in Pydantic AI). **Strands** code mode is close behind (Monty too); set `timeout`, because its defaults allow 60 s of VM time inside a 900 s wall clock, and it has no option to mask host error text. Built into this repo and run on the same benchmark (`engines/COMPARISON.md`), Monty used directly did better than either wrapper: FastMCP's CodeMode drops printed output and, with error masking on, hides the program's own errors, and the Pydantic AI Harness layer accepts only keyword arguments.
- Also eligible, with conditions: langchain-quickjs (its timeout overran 10 to 40 times while the guest printed), Pi codemode (only with limits passed explicitly), OpenClaw with `executor: "quickjs"` (a fixed pool of 4 workers, so cap concurrency at 3), Hermes (Docker backend only), UTCP (but guest logs can grow host memory past 4 GB), and this repo's reworked sandbox (serial tool calls).
- Not eligible as shipped: OpenCode (`fetch` on by default, no time limit in `execute`, no memory option; the host reached 4.3 GB in a second) and Claude Code's Code Mode (no memory limit; 4.5 GB). Both blocked every language-level escape.

### 1. Isolation: an interpreter boundary holds, host-language tricks do not

30 of 69 fail G1 with defaults. Everything that runs model code with `exec`, IPython, `node:vm` seeded with host objects, or a worker thread with a real `require` reached the host: RLM, CodeAct, LangGraph CodeAct, LlamaIndex CodeAct, mcp-use (Python and TS), Agno, Datalayer's eval and Jupyter backends, AutoGen's local executor, Hermes's local kernel, CodeMode Unified's Bun runtime, RestrictedPython codemode, shift-labs, pi-codemode-mcp, OpenClaw's default `node:vm` engine (through injected TextEncoder/TextDecoder), Mastra's LocalSandbox quickstart. Engines that only see injected functions held: QuickJS or quickjs-ng in WebAssembly, V8 isolates, Monty, Starlark, Boa, goja, Hyperlight micro-VMs, CPython for WASI. One exception within that group: Forgemax's V8 worker blocked every probe, but guest output shares the worker's IPC channel, so a program can forge tool-call frames that the host runs. Several projects call themselves sandboxes in the README while their own docstrings say they are not.

### 2. Limits fail more often than isolation, and usually silently

33 of 69 fail G2 and 40 fail G3 with defaults. The recurring causes:

- **Timers inside the guest.** A `Promise.race`, `setTimeout` or asyncio timer on the same event loop never fires during a synchronous loop (Cloudflare, TanStack's Cloudflare driver, mcp-use). Codex code mode returns a progress snapshot every 10 s and lets the program keep running.
- **Memory limits that are accepted and ignored.** QuickJS's `setMemoryLimit` does nothing in quickjs-emscripten's WASM builds (reproduced on 0.31 and 0.32), which affected TanStack's QuickJS driver, Qwen Code, and this repo. voidmcp's timeout is passed to a library that never installs an interrupt handler. Codex code mode overwrites its heap limit with none. mcp-use's TS `memoryLimitMb` is never applied.
- **The WebAssembly ceiling standing in for a limit.** Several "out of memory" results came at 2 to 4 GB, the 32-bit address space, not a configured cap.
- **Whole-process crashes.** Cloudflare's local runtime, Codex code mode and Executor crash on a memory bomb, taking every session with them. Docker's MCP gateway and Stainless's MCP server have no limit and grew until the harness stopped them; Stainless's server also exits when its worker dies.

### 3. Shared-server failures the standard probes miss

The independent checks found problems in implementations that pass all three gates:

- **One user stalls everyone.** Engines on the host's main thread freeze the event loop for the whole timeout (Mastra QuickJS, TanStack QuickJS drivers, and this repo before its rework). OpenClaw's 4-worker pool is exhausted by 4 runaway programs.
- **Logs as a memory leak.** UTCP and TanStack's Node driver keep guest logs in an unbounded host array: past 4 GB in seconds, despite isolate limits.
- **Recursion outside the budget.** Bifrost's Starlark recursion stack is not charged to its memory budget; 12 concurrent scripts took the gateway, which also proxies the LLM calls, past 4 GB.
- **Host error text.** A tool error carrying a database URL reached the model verbatim in Pi, UTCP, TanStack, Pydantic AI Harness, FastMCP (unless masked), Strands, and Hermes's `tool_errors`. Vercel and langchain-quickjs replace it with a generic message.

### 4. The bridge decides whether a program can search in parallel

Async bridges ran five 200 ms tool calls in about 200 ms (Vercel, Monty-based ones, langchain-quickjs, Pi, OpenClaw, Mastra, Cloudflare, Codex, Executor, goose). Synchronous bridges took about 1,000 ms: isolated-vm with `applySyncPromise` (UTCP, TanStack Node), asyncify QuickJS (this repo), the Bifrost and mcp-gway Starlark gateways, Hyperlight, Forgemax's child-process mode despite its "bounded parallel execution" claim. ToolHive's Starlark gateway ran the five calls in parallel (234 ms).

### 5. Tool discovery: keyword search and catalogs, not embeddings

In the source we read, discovery that scales past the prompt is keyword or BM25 search (Pi, FastMCP, Executor, Anthropic's tool search), a catalog the program searches (OpenClaw, Claude Code Code Mode, Qwen Code), optionally deferred tools surfaced by the provider's tool search (Vercel AI SDK, langchain-quickjs, Pydantic AI Harness; by default all three put every signature in the prompt), or meta-tools that read tool files (Bifrost). Lattice's go-agent ranks tools deterministically, with an optional model to choose among them. None of these embeds tool descriptions. Cursor's current docs say its agent search is Instant Grep, a local regex index.

### 6. Credentials belong on the host side of the bridge

The eligible implementations run tools on the host and pass only JSON across, so the program never holds a token. The failures are instructive: Stainless's local MCP server and CodeMode Unified's Bun runtime give the guest the server's full environment; janwilmake's agent-codemode reads the whole Claude Code keychain entry into the process running model code; Composio's local variant puts the project API key inside the sandbox.

### 7. Where the code disagrees with the docs

Beyond wave 1's list (UTCP's benchmark never runs UTCP, Monty's launch article, RLM's "sandboxed namespace", Codex's discarded heap limit): Bifrost's published benchmark counts an HTTP 200 as a pass and keeps its logs out of the repo; RestrictedPython codemode hands the guest the real `__import__` while its README promises no imports; Forgemax lets guest stdout forge IPC frames the host executes; OpenCode's design issue ruled out network access for v1, and v2.3.2 ships `fetch` on by default; Microsoft's Hyperlight post promises a fresh micro-VM per call, and the code restores one snapshot; Hermes's docs say code cannot read environment secrets, and `ps -E` read one.

### 8. This repo's own sandbox

The probes and the reviewers found five bugs in `src/sandbox.ts` over two rounds, all fixed and re-tested with the same suites: executions shared one asyncify module; a dynamic `import()` wedged later runs; the 512 MB memory cap never applied (3.08 GB host memory; now a 512 MB WebAssembly memory maximum); one runaway program froze every other request for 60 s; and the guest could call the bridge with an inherited name and make the host serialize the whole corpus. It now runs each execution in its own worker thread with a 65 s host-side wall clock, a hidden bridge, a streaming output cap and scrubbed host errors. A neighbor request now finishes in about 212 ms while one other program loops, bombs memory or floods logs; with eight runaway programs the 8-way concurrency cap is full and the next request waits up to 65 s. Its bridge is still synchronous, so tool calls inside one program run one at a time.

### What this means for an investigations platform

1. Run model code in an engine that sees only injected functions, one worker or process per execution, with time and memory enforced from outside the guest. Test the limits yourself: in this survey, documented limits were the claim most often false.
2. Keep credentials, case-access checks and tool execution on the host side of the bridge, and pass only JSON across.
3. Treat other users as part of the threat model: cap concurrency per tenant, bound log and output buffers as they grow, and check that a runaway program cannot delay a neighbor.
4. Sanitize host errors before they reach the model.
5. Use an async bridge so one program can query several indexes at once.
6. Check data retention before choosing a hosted option. Anthropic's programmatic tool calling docs list zero data retention and HIPAA as "Not eligible" with "data retained up to 30 days"; OpenAI's docs say its programmatic tool calling supports zero data retention.

### Limits of this comparison

- Timings were taken while up to ten workers shared one 36 GB Mac (load average up to 45). Read them as upper bounds; outcomes did not depend on load.
- On macOS, compressed memory can hide growth from RSS. One no-limit run read 2.8 GB of RSS at a 56 GB footprint. Peak-memory numbers for no-limit rows are lower bounds.
- Hosted platforms were tested only where they run locally. Deployed Cloudflare Workers, E2B, Modal, Daytona and similar may enforce limits that local runs cannot show.
- Microsoft's Hyperlight CodeAct ran only with a dependency version newer than its package allows.
- The robustness checks covered 13 candidates; the rest have the twelve probes only.
- Gate verdicts for the 13 that are not in the hardened run (no stricter options exist) rest on defaults only.
