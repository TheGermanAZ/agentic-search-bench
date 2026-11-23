SHA = "8ff4b865e0e5712c66d5077e93392807daca9354"
GH = f"https://github.com/mcp-use/mcp-use/blob/{SHA}/libraries/typescript/packages/client/src"
VM = f"{GH}/code-mode/executor-vm.ts"
CONN = f"{GH}/code-mode/connector.ts"
NODE = f"{GH}/core/node.ts"
P = "research/probes/mcp-use-codemode-ts"

IMPL = "mcp-use-codemode-ts"
NAME = "mcp-use TypeScript code mode (@mcp-use/client VMCodeExecutor)"
SOURCE = "https://github.com/mcp-use/mcp-use (npm @mcp-use/client 2.4.6)"
PINNED = f"@mcp-use/client 2.4.6 from npm (package.json at {SHA} also says 2.4.6); Node 24.22.1"
LANGUAGE = "JS"
ENGINE = ("node:vm runInNewContext in the agent's own Node process. The context object is a host object literal that carries host intrinsics "
          "(Object, Array, Promise, ...), so the host Function constructor is one property away. Not an isolate.")
HOW_RUN = ("new MCPClient(config, {codeMode: true}); createAllSessions(); sessions.code_mode.connector.callTool('execute_code', {code}), "
           "the path an agent's execute_code call takes. lookup is a stdio MCP server (host_server.py) that counts calls.")

OVERRIDES = {
    "P1": {"display": "works (42, 1 host call)", "detail": "Printed 42 via `await host.lookup({id: 21})`; 1 call counted by the MCP server."},
    "P2": {"detail": "All 200000 printed chars came back in logs (JSON text 200045 chars), no truncation. The bare last expression is not returned (result undefined); `return \"RETURNED\"` returns it (out/PX.txt).",
           "display": "full (200,000 chars), no return"},
    "P3": {"detail": "fetch is not defined, but this.constructor.constructor(\"return process\")() returns the host process; process.getBuiltinModule(\"https\").get(\"https://example.com\") returned 200.",
           "display": "works (via host process)"},
    "P4": {"detail": "require is not defined; the same escaped process loaded fs and read the host /etc/hosts.", "display": "works (via host process)"},
    "P5": {"detail": "process is not defined in the context; the escaped host process gave ENV=s3cr3t.", "display": "works (s3cr3t)"},
    "P6": {"detail": "`while (true) {}` stopped at 30.0 s: \"Script execution timed out\" (vm timeout). `await null; while (true) {}` was never stopped: the vm timeout covers only the synchronous start, and the loop then froze the host event loop until the harness killed the process at 120 s (out/P6b.txt).",
           "display": "limited (30 s; not after await)"},
    "P7": {"detail": "No memory limit. The host Node process reached 4.07 GB RSS in 6.8 s and the harness killed it; the agent process itself is what grows.",
           "display": "no-limit-within-120s (4.1 GB)"},
    "P8": {"display": "fresh", "detail": "Second execution printed \"gone\": a new vm context per execute (executor-vm.ts:213, :356)."},
    "P9": {"display": "parallel (208 ms)", "detail": "Promise.all over five lookups took 208 ms; 5 calls reached the MCP server."},
    "P10": {"detail": "error = \"probe-boom\" (e.message only). The stack, with agent_code.js line:column and host frames, is available only if the code catches and prints it (out/PX.txt, P10-stack).",
            "display": "message only (no stack)"},
    "P11": {"detail": "execute_code median 0.3 ms, p90 0.3 ms over 20 executions in one client. New MCPClient + stdio server: 229 ms.", "display": "median 0.3 ms"},
    "P12": {"detail": "Escaped: this.constructor.constructor(\"return process\")() returned the host process (pid printed) and child_process.execSync wrote the host marker file. (function(){return this})().process is undefined. Object.constructor also reaches host Function (out/PX.txt).",
            "display": "escaped (constructor chain)"},
}

HARDENED_CONFIG = ("codeMode: {enabled: true, executor: 'vm', executorOptions: {timeoutMs: 10000, memoryLimitMb: 128}} (core/node.ts:85-93, 113-120). "
                   "The stricter executor 'e2b' needs an E2B API key: blocked-needs-credentials, not run.")
HARDENED_OVERRIDES = {
    "P3": {"display": "works (via host process)"},
    "P4": {"display": "works (via host process)"},
    "P6": {"detail": "Stopped at 30.0 s, not 10 s: CodeModeConnector.callTool passes `args.timeout || 30000` to executeCode, which overrides the configured timeoutMs (connector.ts:367-372, executor-vm.ts:198). The after-await loop again ran until the harness killed it at 120 s (out/hardened-P6b.txt).",
           "display": "limited (30 s; 10 s ignored)"},
    "P7": {"detail": "memoryLimitMb=128 is accepted but never used (executor-vm.ts:163, :168; node.ts:89-91 says so). The host reached 4.07 GB and the harness killed it.",
           "display": "no-limit-within-120s (4.1 GB)"},
    "P9": {"display": "parallel (216 ms)"},
    "P12": {"display": "escaped (constructor chain)"},
}

DEFAULTS = {
    "time": "30000 ms default (executor-vm.ts:167), but the connector always passes args.timeout || 30000 (connector.ts:367). vm timeout only covers synchronous execution before the first await.",
    "memory": "None. memoryLimitMb is stored and never applied (executor-vm.ts:163-168; node.ts:89-91).",
    "output": "None. logs + result JSON-encoded into one text content (connector.ts:374-383).",
    "tool_calls": "None.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "Per MCP server, a plain object whose properties are async wrappers calling session.connector.callTool and JSON-decoding the first text item. No types generated.",
     "evidence": f"{VM}#L319-L352"},
    {"topic": "Discovery", "finding": "search_tools inside the code and as a separate MCP tool; the model sees two tools (execute_code, search_tools), not every schema.",
     "evidence": f"{GH}/code-mode/executor.ts#L138 ; {CONN}#L160-L230"},
    {"topic": "Bridge", "finding": "Direct in-process async calls from vm code to host closures; no serialization boundary.", "evidence": f"{VM}#L331-L347"},
    {"topic": "Isolation boundary", "finding": "node:vm with host intrinsics (Object, Array, Promise, setTimeout...) placed into the context; the class comment says it runs code \"in an isolated V8 context\". Node documents node:vm as not a security mechanism, and P12 escaped through the constructor chain.",
     "evidence": f"{VM}#L157-L161 (claim) and #L278-L317 (host globals)"},
    {"topic": "Output channel", "finding": "console.* captured into logs; result is the async IIFE's return value; error is e.message. Returned as one JSON text item. No cap.",
     "evidence": f"{VM}#L206-L264 ; {CONN}#L365-L384"},
    {"topic": "Limits", "finding": "Only the vm timeout, which bounds the synchronous part of runInNewContext. memoryLimitMb is documented as reserved and not enforced. The configured timeoutMs is overridden by the connector's default.",
     "evidence": f"{VM}#L162-L172 , #L233-L236 ; {CONN}#L367 ; {NODE}#L85-L93"},
    {"topic": "State", "finding": "New context per execution.", "evidence": f"{VM}#L213 and #L356"},
    {"topic": "Errors", "finding": "error = e.message, or \"Script execution timed out\"; the stack is only logged at debug level.", "evidence": f"{VM}#L239-L254"},
    {"topic": "Anything else", "finding": "Asking for executor 'e2b' without an apiKey logs a warning and silently falls back to the in-process VM executor. Telemetry is on by default (MCP_USE_ANONYMIZED_TELEMETRY=false disables it; the harness set it).",
     "evidence": f"{NODE}#L557-L571 ; {GH}/telemetry/telemetry.ts#L159-L173"},
]

SURPRISES = [
    "The configured executorOptions.timeoutMs is ignored on the agent path: the connector passes `args.timeout || 30000` (connector.ts:367), so the hardened 10 s run stopped at 30 s.",
    "memoryLimitMb is accepted and documented as reserved, but nothing enforces it.",
    "The vm timeout stops only synchronous code before the first await; `await null; while(true){}` freezes the host process indefinitely.",
    "Requesting the E2B executor without a key silently falls back to the in-process node:vm executor with only a log warning (node.ts:557-571).",
    "The executor is described as \"an isolated V8 context\" (executor-vm.ts:159); one constructor-chain expression returns the host process.",
]
