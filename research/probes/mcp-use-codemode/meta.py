SHA = "8ff4b865e0e5712c66d5077e93392807daca9354"
GH = f"https://github.com/mcp-use/mcp-use/blob/{SHA}/libraries/python/mcp_use"
EX = f"{GH}/client/code_executor.py"
CM = f"{GH}/client/connectors/code_mode.py"
P = "research/probes/mcp-use-codemode"

IMPL = "mcp-use-codemode"
NAME = "mcp-use Python CodeModeConnector (MCPClient code_mode=True)"
SOURCE = "https://github.com/mcp-use/mcp-use (PyPI mcp-use 1.7.1)"
PINNED = (f"mcp-use 1.7.1 from PyPI (mcp 1.30.0). Repo read at {SHA}; its code_executor.py differs from 1.7.1 only in using "
          "perf_counter instead of time.time for execution_time.")
LANGUAGE = "Python"
ENGINE = ("CPython exec() of the code wrapped in an async function, inside the agent's own process and event loop, with a hand-picked "
          "__builtins__ dict. The asyncio module is handed to the guest. No process, interpreter or OS boundary.")
HOW_RUN = ("MCPClient(config, code_mode=True); create_all_sessions(); then sessions['code_mode'].connector.call_tool('execute_code', {'code': ...}), "
           "the internal CodeModeConnector an agent's execute_code tool call reaches. lookup is served by a stdio MCP server (host_server.py) that counts calls.")

OVERRIDES = {
    "P1": {"detail": "Printed 42 via `await host.lookup(id=21)`, 1 call counted by the MCP server. Tools are async wrappers grouped by server name.",
           "display": "works (42, 1 host call)"},
    "P2": {"detail": "All 200000 printed chars came back in logs, no truncation. A bare last expression is not returned (result null); `return \"RETURNED\"` returns it (out/PX.txt). The whole JSON goes back to the model as one text block.",
           "display": "full (200,000 chars), no return"},
    "P3": {"detail": "import urllib fails (\"__import__ not found\", out/PX.txt), but the guest is handed the asyncio module: asyncio.open_connection(\"example.com\", 443, ssl=True) fetched HTTP 200.",
           "display": "works (via asyncio global)"},
    "P4": {"detail": "open is not defined, but ().__class__.__base__.__subclasses__() is not filtered: os._wrap_close.__init__.__globals__ gave os.open/os.read, which read the host /etc/hosts.",
           "display": "works (via __subclasses__)"},
    "P5": {"detail": "import os fails, the same __subclasses__ route reached os.environ: ENV=s3cr3t.", "display": "works (s3cr3t)"},
    "P6": {"detail": "No limit for synchronous code. execute() uses asyncio.wait_for(timeout=30) on the same event loop the guest blocks, so the timer never fires; the harness stopped it at 120 s. A loop that awaits asyncio.sleep(0) was stopped at 30.0 s (out/PX.txt, P6-async-loop).",
           "display": "no-limit-within-120s"},
    "P7": {"detail": "No memory limit. The list grew inside the agent's process to 4.04 GB RSS before the harness killed it; a real agent would die with it.",
           "display": "no-limit-within-120s (4.0 GB)"},
    "P8": {"detail": "Fresh: the namespace is rebuilt for every execute (code_executor.py:73).", "display": "fresh"},
    "P9": {"detail": "asyncio.gather over five host.lookup calls took 206 ms; 5 calls reached the MCP server. A sequential loop took 1043 ms.",
           "display": "parallel (206 ms)"},
    "P10": {"detail": "error = \"probe-boom\" (str(e)): no exception type, no traceback, no line number.", "display": "message only (no type, no line)"},
    "P11": {"detail": "execute_code median 1.4 ms, p90 2.2 ms over 20 executions in one session. New MCPClient + stdio server + first run: median 395 ms; one-time setup 297.5 ms.",
            "display": "median 1.4 ms"},
    "P12": {"detail": "Escaped twice: the __subclasses__ walk reached os._wrap_close globals and system() wrote the host marker (PWNED-a); asyncio.create_subprocess_shell wrote it too (PWNED-c). __import__ is not defined. Guest code also reached the MCPClient through the search_tools closure and read every server's config including env (out/closure-check.txt).",
            "display": "escaped (__subclasses__, asyncio)"},
}

HARDENED_CONFIG = ("execute_code timeout=10 (seconds), passed as the tool argument; it is the only knob (code_mode.py:76, client.py execute_code(code, timeout)). "
                   "It is a model-controlled argument, and MCPClient(sandbox=True) sandboxes MCP servers via E2B, not code-mode code.")
HARDENED_OVERRIDES = {
    "P3": {"display": "works (via asyncio global)"},
    "P4": {"display": "works (via __subclasses__)"},
    "P6": {"detail": "Same as default: the synchronous loop blocks the event loop, so the 10 s wait_for never fires; harness stopped it at 120 s.", "display": "no-limit-within-120s"},
    "P7": {"display": "no-limit-within-120s (4.0 GB)"},
    "P12": {"display": "escaped (__subclasses__, asyncio)"},
}

DEFAULTS = {
    "time": "30 s via asyncio.wait_for (code_executor.py:87), default from the execute_code tool schema (code_mode.py:76) which the model can override. It cannot interrupt synchronous code.",
    "memory": "None; guest objects live in the agent process.",
    "output": "None. logs list plus result, JSON-encoded into one TextContent (code_mode.py:132-134).",
    "tool_calls": "None.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "One namespace object per MCP server, built with type(server_name, (), {})(); each tool becomes an async wrapper `await server.tool(**kwargs)` that calls session.call_tool and JSON-decodes the first text content. Names are sanitized to identifiers. No types or stubs are generated.",
     "evidence": f"{EX}#L186-L229 and #L231-L273"},
    {"topic": "Discovery", "finding": "On demand: search_tools(query, detail_level) inside the code and as a second MCP tool, a substring match over name, description and server; detail_level='full' returns input schemas. Only two tools (execute_code, search_tools) are exposed to the model, so the prompt does not grow with the catalog.",
     "evidence": f"{EX}#L275-L352 ; {CM}#L47-L106"},
    {"topic": "Bridge", "finding": "Direct in-process async calls: the wrapper closure holds the MCPClient and awaits the real MCP session. Because the guest shares the process, it can walk that closure to the client and read every server's config and env (out/closure-check.txt).",
     "evidence": f"{EX}#L243-L266 ; {P}/out/closure-check.txt"},
    {"topic": "Isolation boundary", "finding": "Only a curated __builtins__ dict (no __import__, open, eval). It keeps getattr and type and hands over the asyncio module, and exec runs in-process, so __subclasses__ and asyncio subprocess/network APIs reach the host. The docstring calls it \"a secure execution environment\"; P3, P4, P5 and P12 show it is not.",
     "evidence": f"{EX}#L22-L27 (claim), #L136-L180 (builtins, asyncio), #L116-L127 (exec)"},
    {"topic": "Output channel", "finding": "print is replaced with a capture into logs; stdout/stderr are also redirected and appended. The model gets JSON {result, logs, error, execution_time}. No truncation.",
     "evidence": f"{EX}#L67-L104"},
    {"topic": "Limits", "finding": "Only asyncio.wait_for(timeout) around the coroutine, which cannot preempt synchronous loops. No memory, output or call limits.",
     "evidence": f"{EX}#L84-L90"},
    {"topic": "State", "finding": "Fresh namespace per execution; host-side MCP sessions persist.", "evidence": f"{EX}#L72-L73"},
    {"topic": "Errors", "finding": "Any exception becomes error=str(e): message only, no type or line.", "evidence": f"{EX}#L92-L94"},
    {"topic": "Anything else", "finding": "Anonymized telemetry (PostHog and Scarf) is on by default and logs that on import; MCP_USE_ANONYMIZED_TELEMETRY=false turns it off. The harness set it before each run; one early import in this session ran without it.",
     "evidence": f"{GH}/telemetry/telemetry.py#L126-L164"},
]

SURPRISES = [
    "The docstring calls CodeExecutor \"a secure execution environment\" (code_executor.py:25-27). It is exec() in the agent process with the asyncio module and getattr exposed; network, file, env and shell access all worked.",
    "The 30 s timeout cannot stop synchronous code because it is an asyncio timer on the same loop the guest blocks; one `while True: pass` hangs the whole agent.",
    "The timeout is a model-supplied tool argument in the execute_code schema, so the model, not the host, picks its own limit.",
    "Guest code can reach the MCPClient through the search_tools closure and read every configured server's env, where MCP API keys usually live.",
    "Telemetry to PostHog and Scarf is on by default for the library.",
]
