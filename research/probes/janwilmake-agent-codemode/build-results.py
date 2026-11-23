# Writes research/probes/results/janwilmake-agent-codemode.json. Details were written by hand from the reviewed out/ files.
import json, pathlib
here = pathlib.Path(__file__).resolve().parent
O = "research/probes/janwilmake-agent-codemode/out/"
SHA = "1d8b8735b9d085eeeca762edba8cda967b40df17"
GH = f"https://github.com/janwilmake/agent-codemode/blob/{SHA}/"

def p(outcome, display, detail, ev):
    return {"outcome": outcome, "display": display, "detail": detail, "evidence": ev}

probes = {
 "P1": p("works", "works (42, 1 call)", "printed 42; the lookup MCP server counted 1 call. The script opens a StdioMcpClient to research/probes/janwilmake-agent-codemode/lookup-server.mjs and calls callTool(\"lookup\", {id: 21}). 975 ms including tsx startup and spawning the server.", O+"P1.txt"),
 "P2": p("works", "untruncated (200,000 chars, no return)", "All 200,000 chars reached the caller's stdout. A script has no return value, so \"RETURNED\" never appears. Nothing in the package caps output; whatever runs the shell command (the coding agent's Bash tool) decides what the model sees.", O+"P2.txt"),
 "P3": p("works", "works (example.com 200)", "Plain Node fetch returned status 200.", O+"P3.txt"),
 "P4": p("works", "works (no boundary)", "readFileSync(\"/etc/hosts\") read 16 lines; await import(\"fs\") also worked.", O+"P4.txt"),
 "P5": p("works", "works (s3cr3t)", "process.env.PROBE_SECRET printed s3cr3t: the script is an ordinary process with the shell's environment.", O+"P5.txt"),
 "P6": p("no-limit-within-120s", "no-limit-within-120s", "Spun until the harness killed it at 120 s. First run also left the real script process (tsx's grandchild) spinning after the tsx parent was killed; the harness now kills the whole tree it started.", O+"P6.txt"),
 "P7": p("no-limit-within-120s", "no-limit-within-120s (killed at 4.2 GB)", "No limit from the project: the harness killed the process tree at 4,200 MB tree RSS after 5.8 s. Only Node's own default heap ceiling would stop it beyond that.", O+"P7.txt"),
 "P8": p("works", "fresh", "Each script is a new process: the second printed \"gone\". State can still persist through files, since scripts have the whole filesystem.", O+"P8.txt"),
 "P9": p("works", "parallel (252 ms)", "Promise.all over five callTool calls on one StdioMcpClient printed 252; 5 server calls. Requests are matched by JSON-RPC id, so they overlap.", O+"P9.txt"),
 "P10": p("works", "works (Node stack, real line)", "Exit code 1 and Node's stderr: \"P10.ts:3 throw new Error(\\\"probe-boom\\\") ... Error: probe-boom at <anonymous> (.../P10.ts:3:7)\". Message, source line and the real line number survive.", O+"P10.txt"),
 "P11": p("works", "works (173 ms, a new process)", "20 fresh `tsx P11.ts` processes: median 173 ms, p90 250 ms, under machine load average about 33. No one-time setup step beyond npm install.", O+"P11.txt"),
 "P12": p("escaped", "escaped (no boundary; PWNED)", "There is no sandbox to escape. this.constructor.constructor(\"return process\")() returned process (typeof object); the strict-mode sloppy-this form threw TypeError; execSync(\"echo PWNED\") printed PWNED.", O+"P12.txt"),
}

doc = {
 "impl": "janwilmake-agent-codemode",
 "name": "agent-codemode (janwilmake)",
 "source": "https://github.com/janwilmake/agent-codemode (npm agent-codemode 0.1.1)",
 "pinned": f"{SHA} (package.json 0.1.1, same as npm latest); tsx 4.23.12 from the repo's devDependencies; Node 24.22.1",
 "language": "TS",
 "engine": "None of its own. The agent writes a .ts script and runs it in the user's shell with tsx or node, as a normal OS process with the user's files, network, environment and credentials. The package is a client library and CLI for calling MCP servers.",
 "how_run": "Each probe is a .ts file run as a fresh `tsx <file>` process (the runner the README's example uses, README.md:173); the lookup tool is a local stdio MCP server reached through the package's exported StdioMcpClient. The documented mcp.<server> proxy was not used because its name resolution reads the macOS Keychain (see source_notes).",
 "probes": probes,
 "hardened": None,
 "defaults": {
  "time": "None. The package sets no timeout on scripts or on tool calls (no timeout or AbortSignal in src/).",
  "memory": "None from the project; Node's default heap only.",
  "output": "None from the project. The script's stdout goes to whatever ran it.",
  "tool_calls": "None.",
  "hardened": "null: the project exposes no stricter option. It ships no runner, so there is nothing to configure; isolation would have to come from the user's agent or OS.",
 },
 "source_notes": [
  {"topic": "Isolation boundary", "finding": "There is none, by design. The README's own comparison table lists 'Where the code runs: your shell' and says 'No sandbox to deploy'. The package never executes model code; the coding agent writes a script and runs it with tsx in its Bash tool. Code mode here means 'no model between calls', not 'contained code'.", "evidence": GH + "README.md#L73 and #L180; " + O + "P4.txt, P5.txt, P12.txt"},
  {"topic": "Credentials (the main finding)", "finding": "The library's purpose is to hand scripts the user's MCP credentials: McpClient.fromClaudeCode reads the OAuth token from the macOS Keychain item 'Claude Code-credentials' with `security find-generic-password -s ... -w`, plus ~/.claude/.credentials.json. Even a stdio server lookup through mcp.<name> or openSession runs resolveName -> listServers -> listCredentials, which reads the whole Keychain blob. Credentials therefore live inside the process that runs model-written code. SECURITY.md says any process spawned from a Claude Code session can read every MCP token without a prompt.", "evidence": GH + "src/credentials.ts#L80-L92, " + GH + "src/resolver.ts#L52-L54 and #L91-L93, " + GH + "src/client.ts#L65-L69, " + GH + "SECURITY.md#L19-L26"},
  {"topic": "Config discovery", "finding": "Reads MCP server definitions from ~/.claude.json, <cwd>/.mcp.json, ~/.cursor/mcp.json, Windsurf, VS Code settings and Gemini settings, expanding ${VAR} from the environment. HOME is honoured, so config can be redirected, but the Keychain read cannot.", "evidence": GH + "src/clients.ts#L17-L19 and #L80-L129; " + GH + "src/config.ts#L40-L80"},
  {"topic": "API shape", "finding": "A runtime Proxy: mcp.<server>.<method>(args) opens a session lazily and maps camelCase back to the wire tool name against the live tools/list. `agent-codemode types` generates a TS module per server (one Args interface per tool, JSDoc clipped) that merges into the McpServers interface for compile-time checks.", "evidence": GH + "src/proxy.ts#L36-L90; " + GH + "src/codegen.ts#L179"},
  {"topic": "Discovery", "finding": "No in-prompt catalog and no search tool: the agent runs `agent-codemode servers`, `tools <server>` or `types --all` in its shell and reads files. Scales with the agent's own file reading, not a schema dump.", "evidence": GH + "src/cli.ts; " + GH + ".claude/skills/agent-codemode/SKILL.md#L49-L66"},
  {"topic": "Bridge", "finding": "Direct MCP from the script process: Streamable HTTP via fetch for remote servers, newline-delimited JSON-RPC over a spawned child's stdin/stdout for stdio servers. Stdio servers are spawned with {...process.env, ...cfg.env}, so they inherit the script's whole environment.", "evidence": GH + "src/client.ts#L130; " + GH + "src/stdio-client.ts#L46-L51"},
  {"topic": "Output, limits, errors, state", "finding": "None of these are handled by the project: output is the script's stdout, errors are Node's uncaught-exception print and exit code, there are no time, memory, output or call limits, and each run is a new process. CLI exit codes: 0 ok, 1 error, 2 tool isError.", "evidence": GH + "README.md (CLI section); " + O + "P2.txt, P6.txt, P7.txt, P10.txt"},
  {"topic": "Maintenance", "finding": "MIT; version 0.1.1; last commit 2026-08-19 (docs). Small (about 1,550 lines of TS), tests are one smoke script with an echo server.", "evidence": GH + "package.json; " + GH + "test/smoke.mjs"},
 ],
 "surprises": [
  "Not a sandboxed code mode at all: the shipped skill tells the agent to write scripts that run in the user's shell with the user's tokens. It meets the narrow definition (code calls tools, only output returns to the model) with no isolation, so it cannot pass G1, G2 or G3.",
  "Resolving any server name through mcp.<name>, openSession or the CLI reads the entire Claude Code Keychain blob (every MCP token), even when the target is a local stdio server that needs no token.",
  "tsx runs the script in a grandchild process. Killing the tsx process on a timeout left the spinning P6 script orphaned at 100% CPU until the harness killed it by PID; an agent's Bash timeout that kills only its direct child would leave the same orphan.",
  "The README's '290x less into context, 99.66% saved' figure is one prompt against the author's live Linear workspace; it is not reproducible from the repo (no benchmark script ships).",
 ],
}
out = here.parent / "results" / "janwilmake-agent-codemode.json"
out.write_text(json.dumps(doc, indent=2) + "\n")
print("wrote", out)
