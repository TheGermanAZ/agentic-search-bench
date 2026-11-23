# Code-mode engines on this repo, compared

Every engine runs behind the same host contract (src/engines/host.ts): the six corpus functions, 60 s CPU, a 65 s wall clock, 512 MB per execution, an 8,000-char output cap, 8 concurrent executions. Probes: research/probes/engines/run.ts with a stand-in corpus. Neighbor columns time a normal request started 150 ms after a busy loop, a memory bomb or an output flood (about 250 ms means unaffected). Live: the same benchmark questions with exact answers, Claude Sonnet, code mode strategy.

| Engine | Tool call | Output cap | Network | Files | Env secret | Escape | Busy loop | Memory bomb | State | 5 calls | Errors | Host error | Per run | Neighbor: loop | Neighbor: memory | Neighbor: flood | Live correct | Median time | Calls/question | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| quickjs-asyncify | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 661 MB peak | fresh | 1008 ms | message + line | scrubbed | 54.5 ms | 257 ms | 261 ms | 258 ms | 12/12 | 9.6 s | 1.2 | $0.10 |
| vercel-run | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 694 MB peak | fresh | 220 ms | message + line | scrubbed | 3.7 ms | 245 ms | 244 ms | 205 ms | 12/12 | 10.2 s | 1.3 | $0.11 |
| quickjs-ng | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 600 MB peak | fresh | 203 ms | message + line | scrubbed | 53 ms | 254 ms | 258 ms | 257 ms | 12/12 | 10.2 s | 1.3 | $0.11 |
| isolated-vm | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 689 MB peak | fresh | 221 ms | message + line | scrubbed | 1 ms | 202 ms | 204 ms | 204 ms | 12/12 | 12.6 s | 1.3 | $0.11 |
| py-monty | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 172 MB peak | fresh | 222 ms | message + line | scrubbed | 4.7 ms | 203 ms | 202 ms | 203 ms | 12/12 | 10.4 s | 1.3 | $0.10 |
| py-fastmcp | works | no print returned | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 221 MB peak | fresh | 228 ms | hidden | scrubbed | 15.2 ms | 219 ms | 218 ms | 221 ms | 12/12 | 13.2 s | 1.2 | $0.10 |
| py-pydantic-ai | works | capped + marker | blocked | blocked | blocked | blocked | stopped 60 s | stopped, 204 MB peak | fresh | 227 ms | message + line | scrubbed | 15.1 ms | 219 ms | 222 ms | 222 ms | 12/12 | 12.0 s | 1.1 | $0.10 |

## Engines

- **quickjs-asyncify**: QuickJS (quickjs-emscripten 0.32 asyncify) in a fresh Node worker thread per execution; synchronous bridge
- **vercel-run**: Vercel Run 2.1.13 (QuickJS WASM, fresh context per run in a pooled Node worker thread); async bridge, parallel corpus calls
- **quickjs-ng**: quickjs-ng 0.12.1 (quickjs-emscripten 0.32 sync build) in a fresh Node worker thread per execution; async bridge, parallel corpus calls
- **isolated-vm**: isolated-vm 7.0.2 (a fresh V8 isolate per execution on isolated-vm's thread pool, 512 MB heap); async bridge, parallel corpus calls
- **py-monty**: Monty (pydantic-monty 1.6.0, Rust Python-subset interpreter) in a fresh pooled worker process per execution, driven by a Python sidecar; async bridge
- **py-fastmcp**: FastMCP 4.2.4 CodeMode execute tool (Monty 1.6.0 worker per execution) on an in-process FastMCP server in a Python sidecar; call_tool bridge, return value only, errors masked
- **py-pydantic-ai**: Pydantic AI Harness 0.71.0 CodeModeToolset run_code (Monty 1.6.0, fresh pool per execution, ty type check) without an agent, in a Python sidecar; keyword-only async bridge
