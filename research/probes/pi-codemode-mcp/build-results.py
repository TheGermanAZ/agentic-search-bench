"""Writes research/probes/results/pi-codemode-mcp.json. Outcomes and details were written by hand from out/*.txt."""
import json
import pathlib

SHA = "0ad55d6a8d6eeb44a255903bd10f22eacd72539d"
GH = f"https://github.com/mitsuhiko/pi-codemode-mcp/blob/{SHA}"
O = "research/probes/pi-codemode-mcp/out"


def p(outcome, detail, evidence, display):
    return {"outcome": outcome, "detail": detail, "evidence": evidence, "display": display}


probes = {
    "P1": p("works", "printed 42, 1 host call. Tools are reached as call(\"host\", \"lookup\", {id: 21}); the result is {content, structuredContent}, so the value is r.structuredContent.value.", f"{O}/P1.txt", "works (42, 1 call)"),
    "P2": p("works", "All 200,000 printed chars came back in logs[0].message inside the JSON payload (200,144 chars total), no truncation, no marker. The literal bare-expression form returns no result field; `return \"RETURNED\"` returns result \"RETURNED\" plus the logs.", f"{O}/P2.txt", "works (200,000 chars, no cap)"),
    "P3": p("escaped", "fetch is not a global (ReferenceError: fetch is not defined), but the host's fetch is one hop away: Buffer.constructor.constructor(\"return fetch\")() fetched https://example.com and returned \"200 577 bytes\".", f"{O}/P3.txt, {O}/P3b.txt", "escaped (host fetch, example.com 200)"),
    "P4": p("escaped", "require -> ReferenceError; import(\"fs\") -> TypeError ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING; Deno -> ReferenceError. But Buffer.constructor.constructor(\"return process\")().getBuiltinModule(\"fs\").readFileSync(\"/etc/hosts\") returned the file.", f"{O}/P4.txt", "escaped (/etc/hosts via process)"),
    "P5": p("escaped", "process.env.PROBE_SECRET -> ReferenceError: process is not defined; Buffer.constructor.constructor(\"return process\")().env.PROBE_SECRET -> \"s3cr3t\".", f"{O}/P5.txt", "escaped (s3cr3t via Buffer)"),
    "P6": p("limited", "node:vm runInContext timeout: \"Script execution timed out after 30000ms\" at 30,012 ms. Only the synchronous part is covered: `await null; while (true) {}` (P6b) runs on the host event loop after runInContext returns, the withTimeout timer can never fire, and the host process hung until the harness killed it at 120 s.", f"{O}/P6.txt, {O}/P6b.txt", "limited (30 s; async loop hangs host)"),
    "P7": p("no-limit-within-120s", "No memory limit; code runs in the host process's V8 heap. The harness killed the host process at 4,106 MB process-tree RSS after 13.6 s. In Pi this is the agent's own process.", f"{O}/P7.txt", "no-limit-within-120s (killed at 4.1 GB)"),
    "P8": p("works", "fresh globals: globalThis.kept printed gone (new vm context per call). The documented `state` object persists: the second call returned state.keptInState = 7.", f"{O}/P8.txt", "fresh (state object persists)"),
    "P9": p("works", "parallel: 218 ms for 5 x 200 ms lookups, 5 host calls, all five arriving at the MCP server within 1 ms. The first run of a session includes about 400 ms of lazy server spawn (an early run measured 954 ms that way), so the harness warms the connection first. A direct MCP SDK client gave 209 ms as a control.", f"{O}/P9.txt, {O}/P9-control-direct-client.txt", "parallel (218 ms)"),
    "P10": p("works", "isError true; text is JSON {ok: false, error: {name: \"Error\", message: \"probe-boom\", stack}, logs}. The stack names call-mcp-user-script.js:4:9 (user line 1 + 3 wrapper lines; the multi-line case gives 6:7 for user line 3) and also leaks host frames with absolute paths (sandbox-runtime.ts:84, index.ts:356, the probe file).", f"{O}/P10.txt", "works (msg + line +3, host paths)"),
    "P11": p("works", "median 3.8 ms, p90 8 ms in the first run under load average about 40; reruns 0.71 and 0.59 ms median, p90 0.83 to 1.16 ms. Each run is a new vm context in the host process. One-time setup (extension load, session_start, lazy MCP server spawn on first call) 335 to 694 ms.", f"{O}/P11.txt, {O}/P11-run2.txt, {O}/P11-run3.txt", "works (0.6 to 3.8 ms median)"),
    "P12": p("escaped", "this.constructor.constructor(\"return process\")() -> \"[object process]\" (the context global was created in the host realm). Buffer.constructor.constructor(\"return process\")().getBuiltinModule(\"child_process\").execSync(\"echo PWNED\") -> \"PWNED\\n\". console.log.constructor.constructor reaches the same process (pid matches). call.constructor.constructor(\"return globalThis.__HOST_CANARY\")() -> \"host-canary\". Only the sloppy-this form returned undefined.", f"{O}/P12.txt", "escaped (execSync PWNED)"),
}

hardened = {
    "config": f"call_mcp parameter timeoutMs: 1000 (the only limit the extension exposes; schema allows 100 to 300000, default 30000). {GH}/src/index.ts#L324-L330 and {GH}/src/sandbox-runtime.ts#L148-L157. 1000 ms rather than the 100 ms minimum so P9's 200 ms calls can finish. No memory, network or filesystem option exists.",
    "probes": {
        "P3": p("escaped", "Same as default: fetch not a global; the host fetch is reachable through any host-realm constructor (shown in default P3b).", f"{O}/hardened-P3.txt", "escaped (host fetch)"),
        "P4": p("escaped", "/etc/hosts read through Buffer.constructor.constructor -> process.getBuiltinModule(\"fs\").", f"{O}/hardened-P4.txt", "escaped (/etc/hosts via process)"),
        "P5": p("escaped", "PROBE_SECRET read as \"s3cr3t\" through the same escape.", f"{O}/hardened-P5.txt", "escaped (s3cr3t via Buffer)"),
        "P6": p("limited", "\"Script execution timed out after 1000ms\" at 1,002 ms. The async variant `await null; while (true) {}` still hung the host until the 120 s kill (hardened-P6b.txt).", f"{O}/hardened-P6.txt, {O}/hardened-P6b.txt", "limited (1 s; async loop hangs host)"),
        "P7": p("limited", "Stopped by the 1 s vm timeout, not a memory limit, after host RSS reached 1,109 MB. The host survived; the next call returned \"alive\". A longer timeout or an allocation after an await would not be stopped.", f"{O}/hardened-P7.txt", "limited (1 s timeout, 1.1 GB)"),
        "P9": p("works", "parallel: 206 ms, 5 host calls.", f"{O}/hardened-P9.txt", "parallel (206 ms)"),
        "P12": p("escaped", "Same five results as default, including execSync PWNED.", f"{O}/hardened-P12.txt", "escaped (execSync PWNED)"),
    },
}

result = {
    "impl": "pi-codemode-mcp",
    "name": "mitsuhiko/pi-codemode-mcp (Pi extension: list_mcp_tools + call_mcp)",
    "source": "https://github.com/mitsuhiko/pi-codemode-mcp",
    "pinned": f"{SHA} (package.json 0.1.0, last commit 2026-02-22); deps from its package-lock: @modelcontextprotocol/sdk 1.26.0, @mariozechner/pi-coding-agent 0.54.0, @mariozechner/jiti 2.6.5",
    "language": "JS",
    "engine": "node:vm (vm.createContext + vm.Script.runInContext) inside the Pi host process; not a sandbox. The context is seeded with host-realm objects (Buffer, URL, setTimeout, console, the MCP bindings).",
    "how_run": "Loaded src/index.ts with jiti as Pi's extension loader does, passed a minimal ExtensionAPI, fired session_start, then called the registered call_mcp tool's execute({code, timeoutMs?}); the lookup tool is a local stdio MCP server (lookup-server.mjs) registered with --mcp-config mcp.json, HOME pointed at a probe-local folder so no user config or tokens are read.",
    "probes": probes,
    "hardened": hardened,
    "defaults": {
        "time": "30,000 ms (normalizeTimeout, sandbox-runtime.ts:148-157), applied as vm timeout min(timeoutMs, 60,000) to the synchronous part (sandbox-runtime.ts:83-88) and as a promise race (withTimeout, :159-179) that cannot fire while the host event loop is blocked.",
        "memory": "none; runs in the host process's V8 heap.",
        "output": "none in the extension; the whole {result, logs} payload is JSON-stringified (formatSandboxValue, sandbox-runtime.ts:102-114). Only the TUI renderer truncates lines for display (index.ts:414).",
        "tool_calls": "no cap. list_mcp_tools shows 20 tools inline (DEFAULT_INLINE_LIMIT, index.ts:33) and spills the rest to a temp .tsv.",
    },
    "source_notes": [
        {"topic": "Negative result (README)", "finding": "README.md line 15: \"The actual findings are that with how MCP works today, such efficiency gains are not useful.\" Lines 12-13 frame it: \"This was an experiment to see if there is an efficiency benefit of allowing a coding agent interface with MCP in a way that allows composition.\" Lines 15-19 add that \"an MCP server that uses code internally can be very helpful\" and that mitsuhiko's google-workspace-mcp \"actually performs as well as a similar skill does.\"", "evidence": f"{GH}/README.md#L12-L19"},
        {"topic": "Isolation boundary", "finding": "The engine is node:vm. vm.createContext is given host objects Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout, a host console and __api with host async functions. Any of their .constructor.constructor is the host Function, which returns the host process (P12: execSync PWNED; P4/P5 read /etc/hosts and the env). The README calls it 'runs JavaScript in a sandbox'; node:vm is documented by Node as not a security mechanism.", "evidence": f"{GH}/src/sandbox-runtime.ts#L1 and #L54-L67; {GH}/README.md#L6"},
        {"topic": "Limits", "finding": "The vm timeout covers only the synchronous run of the wrapping async IIFE. After the first await, user code runs as host microtasks; withTimeout's setTimeout cannot fire while a microtask spins, so `await null; while (true) {}` freezes the Pi process (P6b). No memory limit.", "evidence": f"{GH}/src/sandbox-runtime.ts#L69-L90 and #L159-L179"},
        {"topic": "API shape", "finding": "No generated per-tool functions. Code gets one generic call(server, tool, args), readResource(server, uri), listTools(query), plus servers, tools (server -> names) and resources maps. call() throws on MCP isError, adds schema hints, and retries once with snake_case -> camelCase args; it returns {content, structuredContent}.", "evidence": f"{GH}/src/index.ts#L1972-L2066 and {GH}/README.md#L80-L94"},
        {"topic": "Discovery", "finding": "On demand: list_mcp_tools(query) does case-insensitive text or /regex/ matching, shows 20 inline with compact signatures, and writes the full list to a temp .tsv for grep. In code, listTools(query) returns matches with inputSchema. Scales past 100 tools without putting schemas in the prompt.", "evidence": f"{GH}/src/index.ts#L33 and #L198-L240; {GH}/src/index.ts#L1994-L2006"},
        {"topic": "Bridge", "finding": "Direct in-process function calls: the bindings are host async closures placed on __api, so a tool call is an ordinary host promise that goes to the MCP SDK Client (stdio/HTTP/SSE). Promise.all overlaps calls (P9 218 ms).", "evidence": f"{GH}/src/sandbox-runtime.ts#L63-L66 and {GH}/src/index.ts#L2028-L2063"},
        {"topic": "Output channel", "finding": "Returns JSON text {result, logs[]} where each log has level, message and ISO timestamp; errors return {ok: false, error: {name, message, stack}, logs}. No size cap.", "evidence": f"{GH}/src/sandbox-runtime.ts#L102-L127 and {GH}/src/index.ts#L362-L384"},
        {"topic": "State", "finding": "New vm context per call (globals fresh), plus a documented `state` object owned by the runtime that persists across calls until resetState: true.", "evidence": f"{GH}/src/sandbox-runtime.ts#L31-L48"},
        {"topic": "Credentials", "finding": "OAuth tokens are stored at ~/.pi/agent/mcp-oauth/<server>/tokens.json and bearer tokens in process env or memory, all host-side, but model code can reach them through the P12 escape (process.env, fs).", "evidence": f"{GH}/src/oauth-handler.ts#L7 and {GH}/README.md#L59-L69"},
        {"topic": "Other", "finding": "It is a Pi extension (package.json pi.extensions), not a standalone MCP server or proxy: it is an MCP client inside Pi. A regex rejects TypeScript-looking code before running it. The repo's own .mcp.json registers Sentry and GitHub Copilot MCP servers, so running Pi in the repo would contact them; the harness avoided that with --mcp-config and a probe cwd.", "evidence": f"{GH}/package.json, {GH}/src/sandbox-runtime.ts#L129-L146, {GH}/.mcp.json"},
    ],
    "surprises": [
        "The README says call_mcp 'runs JavaScript in a sandbox'. It is node:vm seeded with host objects; P12 ran a shell command (execSync echo PWNED), P4 read /etc/hosts, P5 read the env secret, P3b reached example.com with the host fetch.",
        "Even this.constructor.constructor(\"return process\")(), the textbook first try, escapes, because the context global is a host-realm object.",
        "The 30 s timeout does not cover code after the first await: `await null; while (true) {}` hangs the whole host process (P6b, default and hardened).",
        "Error stacks leak absolute host paths of the extension and caller (P10).",
        "It is not an MCP server/proxy but a Pi extension that is an MCP client; the README is the author's own negative result on code-mode efficiency over MCP.",
        "The first call_mcp of a session pays a lazy MCP server spawn (about 400 ms), which made an unwarmed P9 look serial (954 ms) until the arrival timestamps showed all five calls reached the server within 1 ms.",
    ],
}

root = pathlib.Path(__file__).resolve().parents[1]
(root / "results" / "pi-codemode-mcp.json").write_text(json.dumps(result, indent=2) + "\n")
print("wrote", root / "results" / "pi-codemode-mcp.json")
