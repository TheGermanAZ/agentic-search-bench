# Fact-check: code-mode synthesis against the probe evidence

Checked `research/probes/synthesis.md`, the `synthesisBullets` array in `src/site.ts`, and the leaderboard and gate tables at the top of `research/code-mode-comparison.md`, against `research/probes/results/*.json`, `research/probes/verify/REPORT.md`, `research/probes/gates.json`, `research/probes/RUBRIC.md`, and `GATE_OVERRIDES` / `CAVEATS` / `VERIFIED_RANK` in `src/compare-impls.ts`. No probes were re-run. Counts below were taken from the gate table and `gates.json`, not from a fresh generator run.

The arithmetic that is supported, so it is not a finding: 85 result files; 5 docs-only (`anthropic-ptc`, `anthropic-mcp-codeexec`, `openai-ptc`, `openai-code-interpreter`, `cursor`); 10 not run (6 need an account, `codemode-unified-e2b` and `codemode-unified-isolated-vm` are stubs, `datalayer-codemode-docker` and `datalayer-codemode-monty` crash on setup); `claude-code` is the one partly-docs row; 69 remain. Of those 69, the gate table has 30 G1 fails, 33 G2 fails, and 39 G3 fails on the default configuration (partials not counted as fails). `gates.json` lists 15 eligible on defaults and 19 eligible once a hardened config is allowed. Those figures match synthesis lines 3 and 7. The findings are where a sentence is broader than the cell that produced the number.

## Findings

1. **The comparison document still opens with the wave-1 census, which contradicts the tables under it and the current synthesis.**

   Claim, `research/code-mode-comparison.md:5`: "Twenty implementations. Fourteen ran on this machine against all twelve probes." Line 16: "Hard per-execution caps fired only in this repo (512 MB), UTCP (128 MB) and just-bash (string size)." Line 47: "The same probes found two bugs here."

   Evidence: the same file at line 57 says "85 rows: 69 probed hands-on, 10 not run ... 5 docs-only, 1 partly docs," which matches `research/probes/gates.json` (`rows` 85, `probed` 69, `eligible` 19). `src/compare-impls.ts:158` prepends the current `research/probes/synthesis.md`, whose first paragraph is the 85/69 census, not "Twenty implementations." Memory caps that actually fired, per the results files, also include Vercel (64 MiB, `results/vercel-ai-sdk-codemode.json` P7), FastMCP (100 MB), Pydantic AI Harness (256 MiB), Strands (256 MiB), langchain-quickjs (64 MiB), OpenClaw QuickJS (64 MiB), and others. The sandbox write-up in current `synthesis.md:54` describes five bugs, not two.

   Correction: regenerate `research/code-mode-comparison.md` from the current synthesis, or delete lines 3–55. Leave the generated counts, leaderboard, and gate table.

2. **Several leaderboard rows "pass" G2 or G3 only on the literal probe. The intro calls those a time limit and a memory limit that leaves the host alive. ToolHive was overridden for this shape of result; Bifrost, just-bash, TanStack Node, UTCP, and langchain-quickjs were not.**

   Claim, `research/code-mode-comparison.md:61` and `synthesis.md:7`: eligibility is "G2 a time limit of its own" and "G3 a per-execution memory limit that leaves the host alive." The leaderboard then includes Bifrost (#17), TanStack Node (#18), UTCP (#19), just-bash (#11), and langchain-quickjs (#6) as passing all three. `synthesis.md:7` counts them in the 15 and the 19. `synthesis.md:22` names the in-guest timer failures as "Cloudflare, TanStack's Cloudflare driver, mcp-use" and does not name TanStack Node.

   Evidence:

   - **just-bash.** `results/vercel-just-bash.json` P6: the stop is "too many commands executed (>100000)", "The count is the limiter, not the 60 min deadline." With both counters raised, "the loop was still running at 120 s when the driver killed it (P6b)." The default clock does not satisfy "stopped within 120 s." P7 stopped on a 64 MiB string-length cap; a 512 MiB live-bytes cap exists but is not what fired. `GATE_OVERRIDES` has no just-bash entry, so `compare-impls.ts` scores `limited (command count)` as a G2 pass.
   - **Bifrost.** `results/bifrost-codemode.json` P6 display is `limited (op count, 1M steps, 40 ms)` and the detail says "This is an operation budget, not a clock." P7 display is `limited (op count, before 64 MiB)`. Surprise: "Memory budget never fires first." `verify/REPORT.md` (bifrost section and the mismatches list): the P7 pass is a step-limited string loop; recursion is not charged to the allocation budget; 12 concurrent recursive scripts went to 4,146 MB in under 0.8 s and the gateway died. ToolHive's same shape is overridden to G2 partial and G3 fail (`src/compare-impls.ts:58-60`), and `results/toolhive-vmcp-codemode.json` supports that override (one builtin on a 1 GB string ran past 120 s; a 35-step script reached 4.4 GB and the gateway was killed). Bifrost has a caveat (`compare-impls.ts:79`) but remains gate-eligible.
   - **TanStack Node.** `results/tanstack-ai-codemode-node.json` P6 is `limited (30 s)` for a synchronous loop, and the gate table marks G2 pass. `verify/REPORT.md` (tanstack-ai-codemode-node): `await new Promise(() => {})` never returned within 110 s, default and hardened, because isolated-vm's timeout covers synchronous execution only. Two thousand serial tool calls were still going at 110 s. The leaderboard caveat states this; the gate cell and the "15 pass" sentence do not, and synthesis section 2 omits it from the timer list.
   - **UTCP.** Gate cell G3 is pass (`limited (128 MB)`). `verify/REPORT.md` (utcp): a log flood crossed 4 GB host RSS in 12.6 s on the default 128 MB isolate, and in 0.5 s on the hardened 64 MB isolate. The leaderboard caveat (`compare-impls.ts:78`, shown at `code-mode-comparison.md:83`) says "past 4 GB in under 13 s despite the 64 MB isolate limit." The 12.6 s figure is the default 128 MB run. The 64 MB run was 0.5 s. The mechanism (unbounded host `logs` array) is supported; the configuration attached to the 13 s figure is not.
   - **langchain-quickjs.** P6 display is `limited (5 s)` and the gate cell is pass. `verify/REPORT.md`: the log flood ran 51.0 s against a 5 s timeout and 39.6 s against a 1 s hardened timeout. Synthesis line 11 and the caveat do disclose the 10–40× overrun. The gate cell still reads as a clean pass.

   Also in the 15, with the host-stall disclosed in a caveat but not in the gate cell: Mastra QuickJS (a runaway loop blocked the host event loop for the whole timeout, 0 of 50 timer ticks; `results/mastra-codemode-quickjs.json`) and TanStack's QuickJS Bun driver (native QuickJS in the host process, same stall; caveat in `compare-impls.ts:66`).

   Correction: say the 15/19 count is "P6 and P7 scored pass under the rubric," and do not call a step counter, a command counter, or a sync-only timeout a time limit. Drop just-bash, Bifrost, TanStack Node, and UTCP from "passes a memory limit that leaves the host alive," or mark those cells partial the way ToolHive is marked. Point the UTCP caveat at 12.6 s on the 128 MB default and 0.5 s on the 64 MB hardened isolate. Add TanStack Node to the in-guest timer paragraph.

3. **Pydantic AI Harness is described as having no print cap. It has a 10 MiB cap, and the text already printed is still sent to the model.**

   Claim, leaderboard caveat for row 3, from `src/compare-impls.ts:73`: "printed output uncapped unless an output-cap capability is added." The cell itself says `works (200,038 chars, no marker)`.

   Evidence: `results/pydantic-ai-harness-codemode.json` defaults and the output source note: print output is capped at 10 MiB per feed (`_monty_exec.py:271`). The surprise records that an 11 MB print raised `MemoryError` at 10,485,760 bytes and the retry text still carried all of those characters (`out/X-print-cap.txt`, 10,486,097 chars total). P2's 200,038 characters are under that cap, which is why there is no marker. `verify/REPORT.md` (pydantic section): "Print is capped at 10 MiB (`default-R8a.json`)."

   Correction: "Print is capped at 10 MiB by a MemoryError, with no truncation marker, and the characters already printed are still forwarded to the model."

4. **"No model in the loop" and "each implementation twice" do not hold for every one of the 69.**

   Claim, `synthesis.md:3`: "69 were probed hands-on ... with the same twelve probes and no model in the loop, each once with its project's defaults and once with the strictest settings that project itself exposes."

   Evidence: `results/claude-code-codemode.json` `how_run`: "A model was the typist." Haiku drove the interactive REPL; for P6, P7, and P12 a PreToolUse hook swapped the code in after Haiku refused to type it. Hardened P12 attempts 2–8 never ran, because Haiku then refused the 1+1 call as well. The default eight escape attempts did run via the hook and were blocked, so the G1 result can stand, but the method sentence cannot. Separately, these probed rows have `"hardened": null` (no second run, because the project exposes no stricter option): `docker-mcp-gateway-codemode`, `llamaindex-codeact`, `lattice-go-agent`, `dspy-rlm`, `asb-quickjs`, `my-cool-proxy`, `cloudflare-codemode-mcp`, `langgraph-codeact`, `janwilmake-agent-codemode`, `lootbox`, `rlm-docker`, `cmcp`, `restrictedpython-codemode`. That is 13 of the 69.

   Correction: "68 of the 69 were run with fixed code and no model. Claude Code's Code Mode needed Haiku as a typist, with a hook injecting the probes Haiku refused. Where a project exposes a stricter public option it was re-run; 13 probed rows have no such option (`hardened: null`)."

5. **"Two independent reviewers" and "every gate cell they reran matched" overstate `verify/REPORT.md`.**

   Claim, `synthesis.md:3`: "Then two independent reviewers reran the gate probes for the 13 strongest candidates ... Every gate cell they reran matched."

   Evidence: `verify/REPORT.md` is one write-up in the first person ("I measured", "my harness"), plus a same-day second pass over four more candidates, plus a coordinator addendum that reruns only this repo's robustness suite after the rework. It does not name a second independent reviewer. The mismatches section says gate outcomes matched, and then lists results that did not: pi-codemode P7 "3.5 GB RSS" is one sample (that rerun stopped at 1,064 MB; other samples were 1.87 and 3.49 GB), and that 3.5 GB figure is still in the gate table (`code-mode-comparison.md:133`, "partial (limited (wasm32 4 GiB, 3.5 GB RSS))"). Hermes hardened P7: the results detail says the model saw status `error` at 1.97 s; the rerun saw status `timeout` at 11.19 s. Hermes default P6 and P7 were not rerun. The addendum did not rerun asb's P3–P12 after the worker change.

   The "13 strongest" label is also ahead of the report. The report's own ranking says Bifrost, TanStack Node, UTCP, and this repo (before the rework) "would not deploy," and the leaderboard's other gate-passers (Mastra QuickJS, TanStack QuickJS Bun, Hyperlight, just-bash, Pydantic Monty) were not in those 13.

   Correction: "One reviewer reran the gate probes for 13 candidates (Hermes default P6 and P7 excepted). Outcomes matched. pi P7's RSS and Hermes hardened P7's status text did not. A coordinator reran this repo's robustness suite after the rework."

6. **This repo's "neighbor finishes in about 212 ms" is the single-aggressor result. Eight concurrent runaways still stall the next request for about 60 s, and the leaderboard time cell is the pre-rework 60 s probe.**

   Claim, `synthesis.md:54` and `src/site.ts:130`: the five bugs are fixed and re-tested; "A neighbor request now finishes in about 212 ms while another program loops, bombs memory or floods logs." The leaderboard (`code-mode-comparison.md:74`) still shows `limited (60 s)` and `serial (1,006 ms)`.

   Evidence: `verify/REPORT.md` addendum: R9a/R9b/R9c/R9d neighbors took 212–213 ms, and the log flood stopped at the 65 s wall clock. R9e, eight concurrent loops: "B queued 60 s for a free slot (the 8-way cap), then took 213 ms." `results/asb-quickjs.json` P6 is still "interrupted after 60,001 ms" with display `limited (60 s)`. That file's surprises cover the asyncify fix and the WebAssembly.Memory fix (3.08 GB down to 576 MB host RSS on the string bomb, which supports the 3.08 GB figure). They do not record the later worker-thread rework. The 212 ms, the hidden bridge (`A1` now `'__host' is not defined`), and the scrubbed error (`db=<url>`) are in the addendum only.

   The five bug descriptions themselves match the evidence: shared asyncify module (`decisions.tsv` and `results/asb-quickjs.json` surprises), `import()` wedging later runs (same), inert `setMemoryLimit` at 3.08 GB (`results/asb-quickjs.json` P7), the 60 s event-loop stall (`verify/REPORT.md` asb section, R9a started at +60,021 ms), and the corpus dump via an inherited bridge name (`default-A1.json` in that section).

   Correction: "A single neighbor finishes in about 212 ms beside one loop, bomb, or log flood. Eight concurrent runaways fill the 8-wide cap and the next request waits about 60 s for a slot. The wall clock is 65 s. The leaderboard's `limited (60 s)` is the pre-rework probe."

7. **"Starlark gateways" are grouped with the synchronous, ~1,000 ms bridges. ToolHive's Starlark gateway ran the five calls in parallel.**

   Claim, `synthesis.md:38`: "Synchronous bridges took about 1,000 ms: isolated-vm with `applySyncPromise` (UTCP, TanStack Node), asyncify QuickJS (this repo), Starlark gateways, Hyperlight, Forgemax's child-process mode."

   Evidence: `results/toolhive-vmcp-codemode.json` P9: `parallel (234 ms)`, "5 host calls; the plain comprehension took 1,135 ms (serial)," via `parallel()` on goroutines. Bifrost is serial at 1,035 ms (`results/bifrost-codemode.json` P9), and mcp-gway is serial at 1,221 ms. Hyperlight at 1,022 ms and Forgemax's child-process mode at 1,014 ms match the sentence (`results/ms-agent-framework-hyperlight.json`, `results/forgemax.json`). Forgemax's "bounded parallel execution" disagreement is supported: the same file's P9 detail says `forge.parallel` took 1,014 ms, while the documented in-process test mode took 205 ms, and the isolation source note records guest stdout forging IPC frames the host executed (the G1 partial override is supported).

   Correction: "Bifrost and mcp-gway are serial. ToolHive's Starlark gateway is parallel (234 ms) when the script calls `parallel()`."

8. **The isolation paragraph's closed lists leave out implementations that failed the same way, and "V8 isolates held" does not cover Forgemax.**

   Claim, `synthesis.md:16`: "Everything that runs model code with `exec`, IPython, `node:vm` seeded with host objects, or a worker thread with a real `require` reached the host:" followed by a list that ends at "Mastra's LocalSandbox quickstart." Line 17: "Engines that only see injected functions held: QuickJS or quickjs-ng in WebAssembly, V8 isolates, Monty, Starlark, Boa, goja, Hyperlight micro-VMs, CPython for WASI."

   Evidence of G1 failures in those families that the list does not name:

   - Datalayer jupyter, IPython, `os.system` ran (`results/datalayer-codemode-jupyter.json` P12).
   - Hermes default local kernel, `os.system` and popen ran (`results/hermes-execute-code.json` P12). The Docker backend did not; the sentence is about defaults, and Hermes's default is in the gate table as a G1 fail.
   - AutoGen local executor, `os.system` and subclass walk ran (`results/autogen-local.json` P12).
   - CodeMode Unified, Bun runtime, `child_process` and `Bun.spawn` (`results/codemode-unified-bun.json`).

   The named list's members do match their results files (RLM, CodeAct, LangGraph CodeAct, LlamaIndex, both mcp-use ports, Agno, Datalayer eval, RestrictedPython, shift-labs, pi-codemode-mcp, OpenClaw's `node:vm` executor, Mastra LocalSandbox).

   Forgemax is "V8 via deno_core" (`results/forgemax.json`). The twelve isolation probes were blocked, and the same file's isolation note, which the G1 override quotes, says guest stdout can forge IPC frames the host executes: forged `ToolCallRequest` frames dispatched two lookups, and a forged `ExecutionComplete` made the host return the guest's string for a run still in `while(true)`. The gate table correctly says partial. "V8 isolates held" does not.

   The `setMemoryLimit` sentence on line 23 is supported: TanStack QuickJS reproduced it on quickjs-emscripten 0.31.0 and 0.32.0 (`results/tanstack-ai-codemode-quickjs.json`), Qwen Code pins `@jitl/quickjs-singlefile-mjs-release-sync` 0.32.0 and observed no enforcement (`results/qwen-code-codemode.json`), and this repo's P7 detail records the same inert call. voidmcp is the over-specific clause: synthesis says the timeout "reaches a library whose interrupt handler is commented out." `results/voidmcp.json` says `fastschema/qjs` forwards `MaxExecutionTime` to `New_QJS` but "never uses" it, and `qjswasm/qjs.c:15-41` "has no interrupt handler." Not "commented out."

   Line 25's "die on a memory bomb" list is exact for Cloudflare's local workerd, Codex code mode, and Executor (those processes aborted themselves). Docker MCP gateway and, on the sample, Stainless were stopped by the harness or by worker death at the 4 GB rule (`results/docker-mcp-gateway-codemode.json` P7: "the harness killed the container at the 4 GB cap"). They do take down every session. They did not crash themselves the way the other three did.

   Correction: add the four omitted G1 failures, or call the list examples. Say Forgemax's V8 isolate blocked the probe escapes and still accepts forged IPC from guest stdout. Say voidmcp's QuickJS build never installs the interrupt handler.

9. **"CodeMode Unified gives the guest the server's full environment" is true of the Bun runtime only.**

   Claim, `synthesis.md:46`: "Stainless's local MCP server and CodeMode Unified give the guest the server's full environment."

   Evidence: Stainless is supported (`results/stainless-mcp-codemode.json` P5: `process.env.PROBE_SECRET` and `Deno.env.get` both returned the secret; the worker is spawned with the server's full `process.env` and `--allow-env`). CodeMode Unified's Bun runtime inherits the server environment (`results/codemode-unified-bun.json` P5, `s3cr3t`). The Deno runtime is `blocked (no --allow-env)` and the QuickJS runtime is `not-defined` (gate table and those results files). janwilmake's Keychain read and Composio's injected `COMPOSIO_API_KEY` match `results/janwilmake-agent-codemode.json` and `results/composio-remote-sandbox.json` (the Composio row is docs, and the results file says so).

   Correction: "CodeMode Unified's Bun runtime gives the guest the server's full environment. Its Deno and QuickJS runtimes do not."

10. **The page bullets drop conditions the synthesis and the report attach to Strands, and they describe optional discovery modes as the behavior.**

    Claim, `src/site.ts:125`: "Mask host error text yourself (`mask_error_details=True` in FastMCP). Strands is close behind." Line 129: "the Vercel AI SDK and langchain-quickjs defer tools to the provider's tool search."

    Evidence: `verify/REPORT.md` ranks Strands fifth and says to set `timeout`. Defaults are 60 s of VM time plus a 900 s wall clock, host error text is verbatim, and there is no masking option (`results/strands-codemode.json` and the report's strands section). `synthesis.md:10` has the "set `timeout`" condition; the bullet does not. Discovery: Vercel's default `toolDiscovery: 'description'` puts every signature in the tool description; scaling past 100 tools is the `conversation` mode plus the AI SDK's `toolSearch()` (`results/vercel-ai-sdk-codemode.json`, Discovery note). langchain-quickjs puts every exposed signature in the system prompt unless a tool is flagged `defer_loading` and `ProviderToolSearchMiddleware` is in front (`results/langchain-quickjs.json`). Both mechanisms exist. Neither is the default. The "no embeddings" sentence and the Cursor Instant Grep sentence are supported (`results/cursor.json`). Lattice is not: `synthesis.md:42` says "Lattice's go-agent ranks tools with a model." `results/lattice-go-agent.json` says "deterministic ranking plus an optional external decision model," and the harness skipped the model path because it needs a key.

    Related unit slip, `synthesis.md:10`: "30 s and 100 to 256 MiB." FastMCP stopped at `100045946 bytes > 100000000 bytes` (`results/fastmcp-codemode.json` P7), which is 100 MB, not 100 MiB. Pydantic AI Harness is 256 MiB (`268435456` bytes).

    Correction: in the bullet, "Strands is the same shape if you set `timeout`; its defaults are 60 s of VM time and a 900 s wall, and it has no error mask." Say the Vercel and langchain deferral paths are options, not the default. Say Lattice's probed ranking is deterministic, with an optional model. Say "100 MB to 256 MiB."

11. **The Vercel recommendation omits a side effect the report measured: calls already dispatched keep running after the run fails.**

    Claim, `synthesis.md:9`: "more than 32 concurrent tool calls fails the run." The limits named beside it (10 s CPU, 30 s wall, 64 MiB), the ~0.3 s neighbor delay, parallel tool calls, generic host errors, and `console.log` to host stdout are supported. `results/vercel-ai-sdk-codemode.json` defaults record `timeoutMs` 30,000 and `cpuTimeoutMs` 10,000. `verify/REPORT.md`: neighbors at most +274 ms for the AI SDK and +146 ms for `run`; R2b replaced the database URL with `Host tool failed.` / `Host function failed.`

    Evidence for the gap: the same report's R5, and P9b in `results/vercel-ai-sdk-codemode.json`: the 33rd in-flight call fails, and the 32 already dispatched run to completion after the program has been answered (`atReturn {started 32, done 0}`, three seconds later `done 32`). The leaderboard caveat includes the abort-signal warning. The recommendation sentence does not.

    Correction: "The 33rd in-flight call fails the run. The calls already sent keep running unless the tool honors the abort signal."

12. **mcp-run-python's default G3 override says "~3 GiB"; the default runs were near 4 GiB. Hardened G3 is scored pass for the same unconfigured wasm32 ceiling.**

    Claim, gate table row and `src/compare-impls.ts:49`: default G3 partial, "MemoryError near the ~3 GiB WebAssembly ceiling, no configured limit." Hardened G3 is pass (`code-mode-comparison.md:124`).

    Evidence: `results/mcp-run-python.json` default P7: MemoryError "near 4 GiB" in 4 of 5 repeats; in 1 of 5 the harness 4 GiB kill fired first at 4.29 GiB. The ~3 GiB wording matches the hardened runs (sampled peak 2.9–3.6 GiB), which the override does not relabel. There is no configured limit on either run. The "no configured limit" half of the override is supported. The other overrides checked (Qwen `read_file` of `/etc/hosts` with no approval, Lattice's goroutine still running after Execute returns, Forgemax IPC, Agno's `BaseException` swallow, ToolHive's step budget, Hyperlight's 0.10.0 pin) match their results files.

    Correction: default cell, "MemoryError near 4 GiB, and one run hit the harness kill at 4.29 GiB; no configured limit." Do not score the hardened wasm32 ceiling as a clean pass while the default ceiling is partial.

The docs-disagree paragraph (`synthesis.md:50`) matches the results files for the items checked: UTCP's cited benchmark does not run UTCP (`results/utcp-codemode.json`); RestrictedPython hands the guest the real `__import__` (`results/restrictedpython-codemode.json`); Forgemax IPC (above); OpenCode v2.3.2 ships `fetch` by default after a v1 design issue that ruled network out, and the host was killed at 4.27 GB within 1 s (`results/opencode-codemode.json`, display "4.3 GB in 1 s"); Hyperlight's blog says a fresh micro-VM per call and the code restores one snapshot (`results/ms-agent-framework-hyperlight.json`); Hermes's docs say code cannot read environment secrets and `ps -E` read `PROBE_SECRET` on the local backend (`results/hermes-execute-code.json`). Claude Code Code Mode's "4.5 GB" is the measured 4.54 GB, harness-killed, with P12 blocked on the eight attempts the hook ran (`results/claude-code-codemode.json`). Anthropic's "not eligible" for zero data retention and HIPAA, with data retained up to 30 days, and OpenAI's ZDR sentence, are the quotes stored in `results/anthropic-ptc.json` and `results/openai-ptc.json`.

Verdict: The headline recommendation is supported: Vercel AI SDK Code Mode (or Vercel Run) for TypeScript, and Pydantic AI Harness CodeMode or FastMCP CodeMode for Python, are the candidates the gate probes and the shared-server checks put first, provided FastMCP sets `mask_error_details=True`, Pydantic tool errors are sanitized, and Vercel tools honor the abort signal.
