# Writes research/probes/results/qwen-code-codemode.json from the findings below (numbers copied from out/).
import json, os
here = os.path.dirname(os.path.abspath(__file__))
O = "research/probes/qwen-code-codemode/out/"
B = "https://github.com/QwenLM/qwen-code/blob/e8424c88ddd463c56602063efde57c328b917cd4/"
C = B + "packages/core/src/"
def p(outcome, display, detail, ev):
    assert len(display) <= 40, display
    return {"outcome": outcome, "display": display, "detail": detail, "evidence": ev}

probes = {
 "P1": p("works", "works (42, 1 call)",
   "tools.mcp__probe__lookup({id: 21}) resolved to {callId, name, status: 'success', output: '{\"id\":21,\"value\":42}'}; text(JSON.parse(r.output).value) returned 42, 1 host call, 568 ms per exec turn. The SPEC's console.log form fails: \"'console' is not defined\" (console is deleted; text() is the print). MCP tools are deferred, so lookup is not in the exec description and the model must find it with top-level tool_search first.",
   O+"P1.txt, "+O+"exec-declaration.default.json"),
 "P2": p("limited", "truncated (32,000 + marker)",
   "text(\"A\".repeat(200000)) came back as 32,029 chars of tool result: 31,968 A's split head/tail around \"\\n… code mode output truncated …\\n\" (exec layer cap EXEC_MAX_OUTPUT_CHARS 32,000 over the host's 100,000-char cap). Neither the bare last expression \"RETURNED\" nor `return \"RETURNED\"` reached the model: only text()/image()/audio() output is returned; the host computes the return value but ExecTool drops it. 20,000 chars came back whole.",
   O+"P2.txt"),
 "P3": p("not-defined", "not-defined",
   "fetch -> \"'fetch' is not defined\"; typeof fetch/XMLHttpRequest/WebSocket all undefined. Through the bridge, tools.web_fetch({url:'https://example.com'}) entered Qwen Code's approval path: in headless AUTO mode an LLM classifier request went to the mock, and the call was declined (\"Qwen Code requires permission to use web_fetch ... non-interactive mode cannot prompt\"). NET_WATCH saw only 127.0.0.1:42101.",
   O+"P3.txt"),
 "P4": p("not-defined", "not-defined; read_file tool works",
   "require -> \"'require' is not defined\"; import(\"fs\") -> \"could not load module 'fs'\"; Deno -> not defined. But tools.read_file({file_path: '/etc/hosts'}) returned the file with no approval in the default headless config: read_file is a registered code-mode-callable tool and Kind.Read is auto-approved, and it is not restricted to the project directory.",
   O+"P4.txt"),
 "P5": p("not-defined", "not-defined",
   "process -> \"'process' is not defined\"; globals are ECMAScript builtins plus tools, ALL_TOOLS, text, image, audio, generatedImage, setTimeout, clearTimeout, exit. The host child gets only PATH and TMPDIR (host-client.ts:76-90), so PROBE_SECRET is absent even from the child process. No shell tool is exposed in the default headless run.",
   O+"P5.txt"),
 "P6": p("limited", "limited (30 s guest CPU)",
   "while(true){} -> \"Script error:\\ninterrupted\" after 30,244 ms (QuickJS interrupt handler, 30 s guest CPU budget). P6b: await new Promise(r => setTimeout(r, 1e9)) -> killed by the parent wall timer at 60,115 ms: \"JavaScript execution timed out after 60000ms (guest budget 30000ms ...)\". P6c: an endless await-lookup loop ran 564 host calls and was still running at the 120 s harness cap (no-limit-within-120s), because both budgets pause while a nested tool call is in flight.",
   O+"P6.txt, "+O+"P6b.txt, "+O+"P6c.txt"),
 "P7": p("limited", "limited (OOM at ~1.9 GB, not 64 MiB)",
   "a.push(\"x\".repeat(1e6)) ran 8.5 s and failed with \"out of memory\" only when the code-mode host child reached 1,903 MB RSS (CLI tree 2,181 MB). The CLI survived, returned the error as the exec result and finished the session; a fresh exec afterwards returned 2 (P7after). The configured 64 MiB QuickJS limit is not enforced: a guest kept 300 MB and 1,500 MB of live strings and completed (P7c, P7d), and the same library versions alone report \"malloc limit: 67108864 ... malloc_usable_size unavailable\" while holding 200 MB (P7e). What finally stops it is presumably the WASM linear-memory ceiling (inferred, not traced).",
   O+"P7.txt, "+O+"P7after.txt, "+O+"P7-host-direct.txt, "+O+"P7c-host-direct-300MB.txt, "+O+"P7d-host-direct-1500MB.txt, "+O+"P7e-memcheck-library.txt"),
 "P8": p("works", "fresh",
   "Second exec printed \"gone\": a new child process, QuickJS runtime and context per exec.",
   O+"P8.txt"),
 "P9": p("works", "serial (1,065 ms)",
   "Promise.all of 5 lookups: 1,065 ms guest-measured, 5 host calls. The calls enter one scheduler batch, but an MCP tool without readOnlyHint is Kind.Other and runs sequentially. P9b with the same server plus annotations {readOnlyHint: true} (Kind.Read): 261 ms, parallel.",
   O+"P9.txt, "+O+"P9-readonly.txt"),
 "P10": p("works", "works (message + line:col)",
   "\"Script error:\\nprobe-boom\\n    at <anonymous> (exec.js:4:53)\\n ...\". Line numbers are offset by the 3-line wrapper (user line 3 reports exec.js:6). Named frames survive (at inner (exec.js:6:35)). Invalid tool args fail in the normal validation chain: \"params/id must be number\". Unknown tool: \"Unknown or unavailable code mode tool: no_such_tool\".",
   O+"P10.txt"),
 "P11": p("works", "works (94 ms runtime, 167 ms per turn)",
   "Runtime alone (spawn codeModeHost.js + QuickJS WASM init + eval 1+1 + exit, host-direct.mjs): median 94.3 ms, p90 101.5 ms over 20 runs. Through the CLI (tool call issued -> exec result in the next model request, includes scheduler and request build): median 166.6 ms, p90 204.8 ms. One-time setup (CLI spawn to first exec) 0.8 to 3.1 s.",
   O+"P11-host-direct.txt, "+O+"P11.txt"),
 "P12": p("blocked", "blocked",
   "this.constructor.constructor(\"return process\")() -> \"'process' is not defined\" (Function works but stays in the QuickJS realm). (function(){return this})().process -> undefined. Function via tools.lookup and setTimeout constructors: typeof process/require/__callTool all undefined. eval exists, eval('typeof process') -> undefined. WebAssembly, Atomics, SharedArrayBuffer and the __callTool/__appendText host hooks are deleted before user code runs.",
   O+"P12.txt"),
}

hprobes = {
 "P3": p("not-defined", "not-defined",
   "fetch not defined; tools.web_fetch -> \"Unknown or unavailable code mode tool: web_fetch\" (excluded).", O+"hardened-P3.txt"),
 "P4": p("not-defined", "not-defined",
   "require/import/Deno as default; tools.read_file -> \"Unknown or unavailable code mode tool: read_file\".", O+"hardened-P4.txt"),
 "P5": p("not-defined", "not-defined", "process is not defined; same globals as default.", O+"hardened-P5.txt"),
 "P6": p("limited", "limited (30 s guest CPU)",
   "\"interrupted\" after 30,105 ms (no option changes the 30 s budget). P6c: the endless lookup loop was stopped after 286 host calls by --max-wall-time: CLI exit 55, \"Run aborted: wall-clock budget of 60s exceeded (--max-wall-time).\" --max-tool-calls 32 did not fire: nested exec calls are not counted.",
   O+"hardened-P6.txt, "+O+"hardened-P6c.txt"),
 "P7": p("limited", "limited (OOM at >=0.9 GB, not 64 MiB)",
   "\"out of memory\" after 26.4 s; peak sampled host-child RSS 900 MB (tree 1,186 MB); this run took 26 s versus 8.5 s by default, cause not determined, and the 100 ms sampler may have missed the peak. The CLI survived and returned the error. No option lowers the memory limit.",
   O+"hardened-P7.txt"),
 "P9": p("works", "serial (1,044 ms)",
   "5 host calls, 1,044 ms. With readOnlyHint (P9b): 221 ms parallel.", O+"hardened-P9.txt, "+O+"hardened-P9-readonly.txt"),
 "P12": p("blocked", "blocked", "Same six attempts and outputs as default.", O+"hardened-P12.txt"),
}

res = {
 "impl": "qwen-code-codemode",
 "name": "Qwen Code Code Mode (tools.codeModeOnly, exec on QuickJS WASM)",
 "source": "https://github.com/QwenLM/qwen-code (packages/core/src/code-mode, packages/core/src/tools/exec.ts, code-mode.ts); npm @qwen-code/qwen-code",
 "pinned": "npm @qwen-code/qwen-code 0.28.4 (integrity sha512-KH4NHC3xZkjhg38kjmrMgSCE07Fiqm2IQE0gVDjobTarjgrhPL6/h4lEOB4EHAPrn0laPCq+9URtAO1EqG7cRQ==; bundled codeModeHost.js sha256 fd0d6029b936076beaf3bd4261f82bd22916f734fd383fbabe5966e9843da64f); source read at tag v0.28.4 = e8424c88ddd463c56602063efde57c328b917cd4 (2026-11-22). QuickJS via quickjs-emscripten-core 0.32.0 + @jitl/quickjs-singlefile-mjs-release-sync 0.32.0 (packages/core/package.json:113,164).",
 "language": "JS",
 "engine": "QuickJS (2025-09-13) compiled to WASM via quickjs-emscripten, run in a fresh Node child process (codeModeHost.js) per exec call, with a new runtime and context; tool calls cross a framed JSON stdio protocol to the CLI, which runs them through its normal tool scheduler.",
 "how_run": "The released CLI headless (node cli.js -p ... --auth-type openai --output-format json) with tools.codeModeOnly true and lookup as a trusted stdio MCP server; a scripted local OpenAI-compatible mock (no model) returns one exec tool call per fixed probe source, so code reaches ExecTool through CoreToolScheduler exactly as a model's call would. P7 variants and P11's runtime-only timing also drive the bundled codeModeHost.js directly over its stdio protocol (host-direct.mjs).",
 "probes": probes,
 "hardened": {
   "config": "CLI flags --approval-mode default (instead of the headless AUTO classifier) --exclude-tools read_file,glob,grep_search,web_fetch,zoom_image,read_mcp_resource --max-wall-time 60s --max-tool-calls 32 (" + B + "packages/cli/src/config/top-level-options.ts#L257-L263, #L432-L454). The code-mode limits themselves have no option: executeCodeMode only clamps its optional timeoutMs/maxOutputChars down to the constants and ExecTool passes neither (" + C + "tools/exec.ts#L158-L163, " + C + "code-mode/host-client.ts#L133-L141); memory and stack limits are constants (" + C + "code-mode/host.ts#L31-L32). tools.sandbox bwrap/landlock policy is Linux-only (docs/users/features/sandbox.md:23); the macOS seatbelt restrictive-closed/-proxied profiles deny outbound traffic to the localhost model endpoint (proxied allows only localhost:8877, outside this worker's ports) and the open profiles allow file-read* everywhere and all network, so they change nothing the guest can reach; not used. Files: research/probes/qwen-code-codemode/settings.hardened.json, args.hardened.json.",
   "probes": hprobes,
 },
 "defaults": {
   "time": "30 s guest CPU budget via the QuickJS interrupt handler, plus a parent wall timer of 30 s + 30 s startup grace = 60 s; both pause while any nested tool call is in flight, so tool-bound programs have no per-exec time limit (host.ts:200-215, 230-243; host-client.ts:34, 156-198, 242, 274; protocol.ts:15). Not configurable. Run-level --max-wall-time exists for headless runs (off by default).",
   "memory": "Nominal: QuickJS runtime.setMemoryLimit(64 MiB), stack 1 MiB (host.ts:31-32, 210-211). Observed: not enforced (malloc_usable_size unavailable in this build); a guest grows to about 1.5-1.9 GB RSS before \"out of memory\". One child process per exec; exec itself is Kind.Other, so model-issued exec calls run one at a time.",
   "output": "Only text()/image()/audio()/generatedImage() output returns; return values are dropped. text() bounded to 100,000 chars in the host, then the whole exec result to 32,000 chars with a head/tail \"… code mode output truncated …\" marker (output.ts:7-16, protocol.ts:14, exec.ts:176-179). Source 131,072 chars; nested tool output sliced to 100,000 chars; control frames 1 MiB; media 16 items / 10 MiB; 1,024 live timers.",
   "tool_calls": "No per-exec cap. Nested calls are not counted by --max-tool-calls (observed 286 nested calls under --max-tool-calls 32). Nested calls batch within a 5 ms window and run in parallel only when the scheduler deems them concurrency-safe (Kind.Read etc.)."
 },
 "source_notes": [
  {"topic": "API shape", "finding": "Every registered tool whose exposure is code-mode-callable becomes tools.<jsName>(args) (names normalized, collisions resolved lexicographically). The exec description is generated per request from the registry: TypeScript-like signatures from each tool's JSON Schema (schemaToType), plus ALL_TOOLS metadata. In the guest, tools is a frozen Proxy whose entries call a host function __callTool that is deleted from globalThis before user code runs.", "evidence": C+"tools/code-mode.ts#L89-L201, "+C+"tools/code-mode.ts#L203-L256, "+C+"code-mode/host.ts#L443-L494, "+C+"tools/tool-registry.ts#L1102-L1116"},
  {"topic": "Discovery", "finding": "Lazy: deferred tools (all MCP tools are shouldDefer) are omitted from the exec description when tool_search is in scope; the model calls top-level tool_search to get a tool's schema and jsName, then uses it in a later exec. ALL_TOOLS at runtime still lists every callable tool. Scales past 100 tools without putting every schema in the prompt. The captured declaration had 7 top-level tools (agent, autofix_pr, enter_worktree, exec, exit_worktree, send_message, tool_search).", "evidence": C+"tools/code-mode.ts#L229, "+C+"tools/mcp-tool.ts#L1262-L1267, docs/design/lazy-code-mode.md, research/probes/qwen-code-codemode/out/exec-declaration.default.json"},
  {"topic": "Bridge", "finding": "Guest __callTool posts a tool_call frame on stdout; the parent maps jsName to the registry name and calls ToolCallRuntimeContext.dispatch, which the scheduler binds with AsyncLocalStorage. Nested calls get ids <parent>:code:<n>, source 'code_mode', and go through a sibling scheduler: validation, permissions/approvals, hooks, telemetry and output truncation all apply (P3 web_fetch hit the approval classifier; P10 bad args hit schema validation). Credentials stay in the CLI; the child has no tools or config.", "evidence": C+"code-mode/host.ts#L352-L371, "+C+"code-mode/host-client.ts#L208-L276, "+C+"core/coreToolScheduler.ts#L2150-L2178, "+C+"core/coreToolScheduler.ts#L6610-L6627, "+C+"code-mode/tool-call-runtime.ts#L54-L80"},
  {"topic": "Isolation boundary", "finding": "QuickJS/WASM is the stated capability boundary; the child process is defense in depth. Matches the code for capabilities: no module loader, console, process, fetch, Atomics, SharedArrayBuffer, WebAssembly; child env reduced to PATH/TMPDIR (and Windows vars). It does not match for memory: the 64 MiB limit is set but not enforced. The boundary also does not cover what tools can do: read_file (unrestricted path), glob, grep_search and web_fetch are callable from exec by default.", "evidence": "docs/design/code-mode-only.md:100-118, "+C+"code-mode/host.ts#L208-L216, "+C+"code-mode/host.ts#L491-L493, "+C+"code-mode/host-client.ts#L76-L90"},
  {"topic": "Output channel", "finding": "The model sees only helper output (text/image/audio/generatedImage), then \"Script error:\\n<message+stack>\" on failure. host.ts computes and sends the program's return value (boundedValue) but ExecTool only reads result.output, so return values are silently dropped. Two truncation layers, each with a head/tail marker: 100,000 chars in the host, 32,000 for the exec result.", "evidence": C+"code-mode/host.ts#L536-L545, "+C+"tools/exec.ts#L173-L179, "+C+"code-mode/output.ts#L7-L16"},
  {"topic": "Limits", "finding": "All constants: 30 s CPU, 60 s wall (30 s startup grace), 64 MiB/1 MiB memory/stack, 131,072-char source, 100,000/32,000-char output, frame caps, 1,024 timers. Both clocks pause during nested tool calls by design (\"registered host tools, whose own scheduler/ACP timeouts remain authoritative\"), so a loop of tool calls runs unbounded unless the headless --max-wall-time is set.", "evidence": C+"code-mode/protocol.ts#L9-L15, "+C+"code-mode/host.ts#L31-L34, "+C+"code-mode/host.ts#L230-L249, "+C+"code-mode/host-client.ts#L174-L198, docs/design/code-mode-only.md:110-116"},
  {"topic": "State", "finding": "Fresh child process, QuickJS runtime and context per exec; timers, pending calls, VM and runtime are disposed in finally. No snapshot or persistence.", "evidence": C+"code-mode/host.ts#L553-L559, "+C+"code-mode/host-client.ts#L142-L145"},
  {"topic": "Errors", "finding": "QuickJS error message plus stack (exec.js:line:col, offset by the 3-line async wrapper) bounded to 100,000 chars; prefixed \"Script error:\" by ExecTool and flagged EXECUTION_FAILED. Failed nested calls reject the guest promise with the scheduler's error text (sliced to 100,000 chars).", "evidence": C+"code-mode/host.ts#L40-L62, "+C+"code-mode/host.ts#L504-L516, "+C+"tools/exec.ts#L173-L226"},
  {"topic": "Concurrency and budgets", "finding": "Nested calls queued within CODE_MODE_BATCH_WINDOW_MS (5 ms) form one batch; partitionByConcurrencySafety runs only concurrency-safe kinds in parallel. MCP tools are Kind.Read only with readOnlyHint, else serial. Shell calls from code mode are treated as concurrency-safe regardless of the read-only classifier. The headless --max-tool-calls budget ticks only for top-level calls.", "evidence": C+"core/coreToolScheduler.ts#L471, "+C+"core/coreToolScheduler.ts#L1755-L1788, "+B+"packages/cli/src/nonInteractiveCli.ts#L2416, "+B+"packages/cli/src/utils/runBudget.ts#L11-L19"},
  {"topic": "Maintenance", "finding": "Apache-2.0, released 0.28.4 on 2026-11-22 (tag commit date). Code mode is experimental and off by default (tools.codeModeOnly default false).", "evidence": B+"packages/cli/src/config/settingsSchema.ts#L3102-L3111"}
 ],
 "surprises": [
  "Memory: host.ts sets a 64 MiB QuickJS limit and the design doc says \"Runtime memory and stack limits are fixed\", but the limit is not enforced in this QuickJS/WASM build: guests held 1.5 GB and the host child reached about 1.9 GB RSS before \"out of memory\" (P7, P7c-e).",
  "The design doc lists timers among things the guest does not have (code-mode-only.md:93, 108); the code installs setTimeout/clearTimeout (host.ts:405-441) and the model-facing description documents them.",
  "Time budgets pause during nested tool calls, so an exec that keeps calling tools never times out (564 calls in 120 s); the design doc states this deliberately, but --max-tool-calls (documented as cumulative tool calls in the run) does not count those nested calls; only --max-wall-time stopped it.",
  "The design doc says exec calls keep Qwen Code's output budgets; the runtime additionally drops program return values: host.ts serializes the value, ExecTool never reads it. The model-facing description does say bare return values produce no output.",
  "The SPEC's console.log fails (\"'console' is not defined\"); text() is the only print.",
  "P9 depends on MCP annotations: identical lookups run serially (1,065 ms) unless the server sets readOnlyHint (261 ms). The description tells the model \"Safe calls run concurrently\" without saying which are safe.",
  "Headless default approval mode is AUTO, an LLM classifier: web_fetch from exec sent a classifier request to the model endpoint (the mock's non-answer led to decline), while read_file of /etc/hosts needed no approval at all."
 ]
}
out = os.path.join(here, "../../results/qwen-code-codemode.json")
json.dump(res, open(out, "w"), indent=2, ensure_ascii=False)
print("wrote", os.path.normpath(out))
