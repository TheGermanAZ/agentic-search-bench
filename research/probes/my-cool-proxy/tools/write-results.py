import json, sys
B = "https://github.com/karashiiro/my-cool-proxy/blob/46bfe3810988b202a6458868f77597b3874ae1de/"
R = B + "packages/lua-runtime/src/runtime.ts"
X = B + "apps/gateway/src/tools/execute-lua-tool.ts"
G = B + "apps/gateway/src/tools/gateway-builtins-builder.ts"
O = "research/probes/my-cool-proxy/out/"
W = "research/impls/my-cool-proxy/npm/node_modules/wasmoon/dist/index.js"
def p(outcome, display, detail, ev): return {"outcome": outcome, "display": display, "detail": detail, "evidence": ev}
d = {
 "impl": "my-cool-proxy",
 "name": "My Cool Proxy (Lua code-mode MCP gateway)",
 "source": "https://github.com/karashiiro/my-cool-proxy (npm @karashiiro/my-cool-proxy)",
 "pinned": "npm @karashiiro/my-cool-proxy 1.6.2 (ran); source read at 46bfe3810988b202a6458868f77597b3874ae1de (2026-04-09, package version 1.6.2); wasmoon 1.16.0",
 "language": "Lua 5.4",
 "engine": "wasmoon 1.16.0: the reference Lua 5.4 interpreter compiled to WebAssembly, run in the gateway's Node.js process on the main thread, a new LuaEngine per execution. JS values cross with wasmoon's default proxying (enableProxy true).",
 "how_run": "npm install @karashiiro/my-cool-proxy@1.6.2 into research/impls/my-cool-proxy/npm; started bin/my-cool-proxy.mjs with CONFIG_PATH=config.json (transport http on 127.0.0.1:41420, one HTTP MCP client `probe` = lib lookup server on 41421) and HOME/XDG dirs pointed at a probe folder. Each driver session first calls list-servers and tool-details(probe, lookup), as the execute tool description requires, then calls execute {script}. A second run used transport stdio (stdio-inject.mjs).",
 "probes": {
  "P1": p("works", "works (42, 1 call)", "probe.lookup({id=21}):await() returned a table (JSON auto-parsed); result(r.value) -> \"Script executed successfully.\\n\\nResult:\\n42\", 1 host call, 206 ms. Without a prior tool-details call the same script fails (\"cannot be called without prior inspection\"), and the very first execute in a fresh session saw no servers (\"Available servers: (none connected)\") until list-servers had run.", O+"P1.txt"),
  "P2": p("works", "works (return only; >50 KB offloaded)", "print() output never reaches the caller: it goes to the gateway's stdout (one 200,000-char line found in out/proxy.log). result(\"RETURNED\") came back. result(string.rep(\"A\",200000)) was not returned inline: \"Result offloaded (200000 bytes, string). Execution ID: ...\" with a snippet showing _gateway.get_result({id}) to fetch and filter it (resultSizeThreshold default 50,000). On the stdio transport the same print() lands in the JSON-RPC stream.", O+"P2.txt, "+O+"P2-print-destination.txt, "+O+"stdio-inject.txt"),
  "P3": p("not-defined", "not-defined", "require(\"socket.http\") -> \"attempt to call a nil value (global 'require')\". io.popen -> \"attempt to index a nil value (global 'io')\". Lua has no network API and the gateway removes io and require.", O+"P3.txt"),
  "P4": p("not-defined", "not-defined", "io.open -> nil global 'io'; loadfile and dofile -> nil.", O+"P4.txt"),
  "P5": p("not-defined", "not-defined", "os.getenv -> \"attempt to index a nil value (global 'os')\". Gateway had PROBE_SECRET=s3cr3t.", O+"P5.txt"),
  "P6": p("no-limit-within-120s", "no limit (freezes whole gateway)", "while true do end ran until the 120,002 ms harness cap and kept 96-100% CPU afterwards. It runs on Node's main thread, so the whole gateway stopped answering: a new session's initialize timed out after 5 s during the loop. SIGTERM could not stop the process either (its SIGTERM handler never runs while the loop holds the event loop); only SIGKILL did.", O+"P6.txt, "+O+"P6-concurrent.txt"),
  "P7": p("limited", "limited (wasm32 heap, ~2.2 GB RSS)", "\"Script execution failed:\\nnot enough memory\" after 6,655 ms; gateway RSS peaked at 2,178 MB. The stop is the WebAssembly heap ceiling of wasmoon's build, not a limit the gateway sets. The gateway survived and served 20 more runs (median 1.95 ms), but RSS stayed at about 1.2 GB afterwards, and other sessions were stalled for the 6.7 s the allocation loop held the event loop.", O+"P7.txt, "+O+"P7-after.txt"),
  "P8": p("works", "fresh", "Second execution returned \"gone\": a new LuaEngine per execute.", O+"P8.txt"),
  "P9": p("works", "parallel (208 ms)", "Five probe.lookup calls started before any :await() finished in 208 ms total, 5 host calls. Tool calls return JS promises, so starting them first and awaiting later overlaps them.", O+"P9.txt"),
  "P10": p("works", "works (message + line, isError)", "isError true, \"Script execution failed:\\n[string \\\"error(\\\"probe-boom\\\")\\\"]:1: probe-boom\\nstack traceback: ...\". A throw on user line 3 reports :3: (no offset). Chunk name is the first line of the script.", O+"P10.txt"),
  "P11": p("works", "works (median 1.3 ms over HTTP)", "20 executions of result(1 + 1) over the HTTP MCP endpoint: median 1.3 ms, p90 1.7 ms (second run after P7: median 1.95 ms). One-time setup (connect, list-servers, tool-details) 93 ms.", O+"P11.txt, "+O+"P7-after.txt"),
  "P12": p("escaped", "escaped (writes host Object.prototype)", "Function-constructor routes were blocked: server tool functions and result() are plain Lua functions (\"attempt to index a function value\"), and the promise userdata has no constructor. But tool results come back as wasmoon proxies of real JS objects: r.__proto__ is the gateway's own Object.prototype, r.constructor is callable, and writes go through. One script ran r.__proto__.probePolluted = \"written-by-guest-lua\"; after that every new MCP session, including a raw curl initialize, got \"Parse error: Invalid JSON-RPC message\" until the gateway was restarted. No process, env or fs access was reached in these attempts.", O+"P12.txt, "+O+"P12b-P12.txt, "+O+"P12c-P12.txt, "+O+"P12-pollution.txt"),
 },
 "hardened": None,
 "defaults": {
  "time": "None. executeScript calls engine.doString(script) with no timeout; wasmoon's own functionTimeout and per-call timeout options are not used.",
  "memory": "None set by the gateway. The only stop is the wasm32 heap ceiling of the wasmoon build (hit at about 2.2 GB RSS in P7). wasmoon's traceAllocations/setMemoryMax option is not used.",
  "output": "print() is not returned (goes to process stdout). The result() value is returned inline up to resultSizeThreshold (default 50,000 bytes), above that offloaded with an execution ID and a schema summary.",
  "tool_calls": "No cap.",
  "hardened_null_reason": "The documented config (docs/configuration.md) has no execution timeout, memory, or call-count option; only resultSizeThreshold and tool filtering. wasmoon exposes functionTimeout, a doString timeout and setMemoryMax, but the gateway does not wire them to config, and RUBRIC forbids adding wrappers."
 },
 "source_notes": [
  {"topic": "API shape", "finding": "Each connected MCP server becomes a Lua global table named by sanitizeLuaIdentifier(server), with one function per tool from client.listTools() (called on every execution). Each function returns a JS promise that the script unwraps with :await(). result(value) sets the return value. A _gateway table adds resource, prompt, completion, stats and offloaded-result builtins.", "evidence": R+"#L182-L390, "+X+"#L45-L83"},
  {"topic": "Discovery", "finding": "On demand through MCP tools: list-servers, list-server-tools, tool-details and inspect-tool-response. A guard refuses any tool call from Lua until tool-details or inspect-tool-response has been called for that tool in the session, so the model must read the schema first. Server instructions preload brief excerpts of servers and tools. Scales past 100 tools without putting all schemas in the prompt.", "evidence": G+"#L299-L316, "+R+"#L339-L388, "+B+"README.md#L88-L100"},
  {"topic": "Bridge", "finding": "wasmoon calls the JS wrapper directly in-process; the wrapper runs the guard synchronously, then calls the upstream through the MCP client's experimental tasks callToolStream. Results: structuredContent, else JSON-parsed single text, else the whole CallToolResult. An upstream isError result is thrown into Lua.", "evidence": R+"#L209-L330"},
  {"topic": "Isolation boundary", "finding": "Lua 5.4 in WebAssembly in the gateway's Node process. createEngine sets os, io, require, dofile, loadfile, package and debug to nil; load and string.dump remain. JS objects reach Lua as wasmoon proxies (enableProxy defaults to true), which exposes host-realm objects such as Object.prototype to reads and writes (P12).", "evidence": R+"#L154-L180; "+W+":1187 (LuaEngine options default enableProxy = true)"},
  {"topic": "Output channel", "finding": "Only result() goes back. Objects become JSON text plus structuredContent; strings become \"Script executed successfully.\\n\\nResult:\\n...\"; results above resultSizeThreshold (50,000) are offloaded with an ID. print() is wasmoon's stdout, which is the gateway's stdout; on the stdio transport that is the JSON-RPC channel, and out/stdio-inject.txt shows a guest print forging the response to the pending tools/call (client saw \"FORGED by guest print for id 3\" instead of \"REAL-2\").", "evidence": X+"#L189-L262, "+O+"stdio-inject.txt"},
  {"topic": "Limits", "finding": "No time, memory or call-count limit in the gateway. wasmoon supports functionTimeout, a doString timeout and setMemoryMax with traceAllocations, none of which are passed.", "evidence": R+"#L26-L31 and #L157, "+W+":148, :522, :1187"},
  {"topic": "State", "finding": "New LuaEngine per execution, closed in finally. Host-realm state is shared across executions and sessions through the proxied JS objects (P12 pollution persisted until restart).", "evidence": R+"#L43-L45 and #L124-L126, "+O+"P12-pollution.txt"},
  {"topic": "Errors", "finding": "Errors return isError true with \"Script execution failed:\" plus the Lua message, chunk line and traceback, and targeted hints for nil globals (unknown server) and nil fields (unknown tool).", "evidence": R+"#L67-L123, "+X+"#L250-L262"},
  {"topic": "Credentials", "finding": "Upstream server credentials (headers, env for stdio servers) live in the gateway config; Lua sees only tool results. OAuth is not supported yet (README).", "evidence": B+"docs/configuration.md, "+B+"README.md#L189"},
  {"topic": "Maintenance", "finding": "MIT license; last commit on main 2026-04-09; npm 1.6.2.", "evidence": B+"LICENSE"},
 ],
 "surprises": [
  "Guest Lua can write to the gateway's own Object.prototype through a proxied tool result; one such write made every later MCP session fail with \"Invalid JSON-RPC message\" until restart (out/P12-pollution.txt).",
  "An infinite loop freezes the entire gateway, every session, and blocks graceful SIGTERM shutdown; only SIGKILL stops it.",
  "On the stdio transport, print() writes into the JSON-RPC stream and can forge responses (out/stdio-inject.txt).",
  "The memory stop is an accident of wasm32, at about 2.2 GB of gateway RSS, and the memory is not returned afterwards (RSS stayed about 1.2 GB).",
  "The first execute in a new session sees no servers until list-servers has run, and tool calls fail until tool-details has been called for that tool.",
  "wasmoon ships timeout and memory-cap options that the gateway does not use.",
 ],
}
json.dump(d, open(sys.argv[1], "w"), indent=2)
for k, v in d["probes"].items(): assert len(v["display"]) <= 40, (k, v["display"])
