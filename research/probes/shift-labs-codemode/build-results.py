# Writes research/probes/results/shift-labs-codemode.json. Details were written by hand from the reviewed out/ files.
import json, pathlib
here = pathlib.Path(__file__).resolve().parent
O = "research/probes/shift-labs-codemode/out/"
SHA = "88de08941f62c52ecfde9f763ecb8bc8e8bad5b3"
GH = f"https://github.com/shift-labs-ai/codemode/blob/{SHA}/"
ENG = GH + "packages/codemode/src/core/engine.ts"

def p(outcome, display, detail, ev):
    return {"outcome": outcome, "display": display, "detail": detail, "evidence": ev}

probes = {
 "P1": p("works", "works (42, 1 call)", "printed 42, 1 host call. The tool is reached as host.lookup: actions are always plugin.action, so a bare lookup() cannot be registered. 585 ms on the first run (includes spawning the pooled worker).", O+"P1.txt"),
 "P2": p("limited", "truncated (last 49.8 KB + marker)", "Bare last expression is not returned (no result field): code runs as an async function body, so only `return` returns. The return form gave \"RETURNED\". The 200,000-char print was cut to its last 51,006 chars, followed by \"[Showing the last 49.8KB of line 1 (195.3KB in all). Full output: <outputDir>/codemode-logs-....log]\". The whole log is written to a file on the host.", O+"P2.txt"),
 "P3": p("works", "works (globalThis.fetch 200)", "The literal `await fetch(...)` throws \"Error: fetch is disabled in codemode sandbox\" because the engine shadows the name fetch with a stub. One step around it, `globalThis.fetch(\"https://example.com\")` returned status 200: Node's real fetch is on the worker global. require(\"node:https\") is also available.", O+"P3.txt"),
 "P4": p("works", "works (require fs)", "require(\"fs\").readFileSync(\"/etc/hosts\") returned the whole file; await import(\"fs\") also worked.", O+"P4.txt"),
 "P5": p("blocked", "blocked literal; ps eww leaks it", "process.env.PROBE_SECRET is undefined and Object.keys(process.env).length is 0: the worker is created with env: {}. But the worker shares the host PID, and require(\"node:child_process\").execSync(\"ps eww -o command= -p \" + process.pid) printed the host's environment; the probe returned sawProbeSecret: true (only a boolean left the run).", O+"P5.txt"),
 "P6": p("limited", "limited (30 s)", "\"Execution timed out after 30000ms\" after 30,003 ms; the worker is terminated and the next run on the same instance returned 2.", O+"P6.txt"),
 "P7": p("error", "host crash (7/24 runs; else 64 MB)", "Literal SPEC code, 24 runs in fresh host processes: 17 returned \"Memory limit exceeded (64MB)\" in about 0.15 s with the host alive; 7 aborted the whole host process (SIGABRT, \"FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\" from a worker thread stack). With a second distinct-string variant in the same process, 6 of 12 runs aborted the host. Peak tree RSS 178 to 251 MB.", O+"P7-literal-trials/, P7-trials/, P7.txt"),
 "P8": p("works", "fresh (globals); process persists", "globalThis.kept = 7 then typeof kept gave \"gone\": the pooled worker deletes new globals after each run. But process.keptOnProcess = 11 set in one run was still 11 in the next run on the same pooled worker: the scrub covers globalThis own properties and listed intrinsics, not the process object.", O+"P8.txt"),
 "P9": p("works", "parallel (201 ms)", "Promise.all over five host.lookup calls printed 201 (202 ms total), 5 host calls. Each call is an async postMessage, so calls overlap.", O+"P9.txt"),
 "P10": p("works", "works (message + stack, line +3)", "error field: \"Error: probe-boom\\n    at eval (eval at __run ([worker eval]:502:16), <anonymous>:4:7) ...\". Message and stack survive; user line N appears as <anonymous>:N+3. execute() does not throw; result is null.", O+"P10.txt"),
 "P11": p("works", "works (0.46 ms pooled; 90 ms fresh)", "Pooled worker (default): median 0.46 ms, p90 0.64 ms over 20 runs. Codemode.create 0.02 ms; the first execute spawns the worker, 102.6 ms. With maxRunsPerWorker: 1 (a new worker every run): median 89.8 ms, p90 93.5 ms. Machine load average was about 33 during the run.", O+"P11.txt"),
 "P12": p("escaped", "escaped (child_process PWNED)", "this.constructor.constructor(...) and (function(){return this})() both fail with TypeError because the body runs in strict mode (this is undefined). That does not matter: process is a live global (typeof \"object\", process.pid equals the host PID, Node 24.22.1), and require(\"node:child_process\").execSync(\"echo PWNED\") returned \"PWNED\\n\".", O+"P12.txt"),
}

hp = {
 "P3": p("works", "works (globalThis.fetch 200)", "Same as default: literal fetch stub throws, globalThis.fetch returned 200. With outputLimit {lines: 3, bytes: 1024} the stub's error was cut to its last stack line, so the message itself was not returned.", O+"hardened-P3.txt"),
 "P4": p("works", "works (require fs)", "require(\"fs\") read /etc/hosts; result cut to its last line by the 3-line output limit, with a marker naming the full-result file.", O+"hardened-P4.txt"),
 "P5": p("blocked", "blocked literal; ps eww leaks it", "process.env empty (0 keys); ps eww on the shared PID still showed PROBE_SECRET=s3cr3t (sawProbeSecret: true). No option changes the worker env.", O+"hardened-P5.txt"),
 "P6": p("limited", "limited (5 s)", "\"Execution timed out after 5000ms\" after 5,014 ms.", O+"hardened-P6.txt"),
 "P7": p("limited", "limited (16 MB)", "24 of 24 runs in fresh host processes returned \"Memory limit exceeded (16MB)\" in 0.8 to 1.25 s with the host alive (peak tree RSS 113 to 126 MB). Not proven safe: the default 64 MB run crashed the host 7 of 24 times, and nothing in the code makes the smaller heap structurally safer.", O+"hardened-P7-literal-trials/, hardened-P7.txt"),
 "P9": p("works", "parallel (229 ms)", "Printed 229; 488 ms total because maxRunsPerWorker: 1 spawns a worker per run. 5 host calls.", O+"hardened-P9.txt"),
 "P12": p("escaped", "escaped (child_process PWNED)", "Unchanged: process is live and require(\"node:child_process\").execSync(\"echo PWNED\") returned \"PWNED\\n\". No public option removes require or process.", O+"hardened-P12.txt"),
}

doc = {
 "impl": "shift-labs-codemode",
 "name": "Shift Labs codemode (@shiftlabs/codemode, formerly runline)",
 "source": "https://github.com/shift-labs-ai/codemode",
 "pinned": f"{SHA} (packages/codemode 0.46.0 in package.json; the npm 0.46.0 tarball is an older commit, 96683925, so the pinned source was compiled with tsc instead)",
 "language": "JS",
 "engine": "Node.js worker_threads Worker (eval: true, env: {}, resourceLimits.maxOldGenerationSizeMb) in the host process; bodies compiled with new Function and handed a real require and process. Run under Node 24.22.1.",
 "how_run": "Codemode.create({ plugins: [hostPlugin] }) then codemode.execute(code) from packages/codemode/src/sdk.ts, compiled with tsc from the pinned source; lookup is the action host.lookup with a TypeBox input schema.",
 "probes": probes,
 "hardened": {
  "config": "Codemode.create({ timeoutMs: 5000, memoryLimitBytes: 16 MiB, maxRunsPerWorker: 1, outputLimit: { lines: 3, bytes: 1024 }, outputDir }) per docs/sdk.md 'Instance lifecycle' and 'Limit a run's result' (" + GH + "docs/sdk.md). 8 MiB is the engine floor but no worker starts below 12 MiB (out/hardened-min-memory.txt). No option restricts require, process, files, network or child processes; docs/security.md tells users to add an OS sandbox themselves, which the project does not ship.",
  "probes": hp,
 },
 "defaults": {
  "time": "30,000 ms per run (config/types.ts:50); worker.terminate() on expiry. timeoutMs 0 disables it.",
  "memory": "64 MiB V8 old generation per worker via resourceLimits (config/types.ts:51, engine.ts:413). Not reliable: 7 of 24 P7 runs aborted the whole host.",
  "output": "2,000 lines and 50 KB per result, error and logs, keeping the last lines and naming a full-output file (utils/output-limit.ts:17-18).",
  "tool_calls": "No per-run cap found. Each action may hold 8 MiB of output (maxActionOutputBytes).",
 },
 "source_notes": [
  {"topic": "Isolation boundary", "finding": "A worker_threads Worker inside the host process, created with eval: true, env: {} and resourceLimits. Bodies are compiled with new Function and receive require (a wrapper that only blanks worker_threads.parentPort) and the global process. The authors say plainly it is not a sandbox, and the code matches that.", "evidence": ENG + "#L401-L414, #L1308-L1330, #L1343; " + GH + "docs/security.md#L5 and #L17"},
  {"topic": "Env secrets", "finding": "env: {} empties process.env inside the worker, and the comment explains why (host secrets one line away). docs/security.md:17 says the worker keeps the host's environment away from calling code. P5 shows ps eww on the shared PID still prints the host env, so that claim does not hold once child_process is available.", "evidence": ENG + "#L402-L412; " + GH + "docs/security.md#L17; " + O + "P5.txt"},
  {"topic": "API shape", "finding": "Each plugin is a Proxy global; calling plugin.a.b(args) posts {t: 'invoke', path, args} to the host, which validates args against the action's TypeBox schema, resolves a connection, and runs execute(). Names are always plugin.action.", "evidence": ENG + "#L962-L972 and #L600-L640"},
  {"topic": "Discovery", "finding": "On demand, inside the program: actions.find(query, limit = 5) searches with the ferrosearch native index, actions.describe(path) returns one signature, actions.check(path, input) validates without calling. No schema dump in the prompt, so it scales past 100 tools.", "evidence": ENG + "#L1130; " + GH + "docs/how-codemode-works.md"},
  {"topic": "Bridge", "finding": "Async postMessage over the worker's parentPort with an unguessable runId per run (randomUUID) so a body cannot forge a done message for another run. Calls return promises, so Promise.all overlaps them (P9).", "evidence": ENG + "#L106-L128, #L736-L739, #L909-L919"},
  {"topic": "Output channel", "finding": "ExecuteResult {result, error, logs}. result is the JSON of the returned value; console.* is bridged into logs. Each is cut to 2,000 lines / 50 KB keeping the last lines, with a marker naming a full-output file the host writes to outputDir.", "evidence": GH + "packages/codemode/src/utils/output-limit.ts#L17-L18; " + ENG + "#L444"},
  {"topic": "Limits", "finding": "Timeout via a host setTimeout that terminates the worker (#L453-L466). Memory via resourceLimits.maxOldGenerationSizeMb on Node; an RSS watchdog arms only under Bun, which ignores resourceLimits (#L190-L198, #L469-L485). OOM surfaces as ERR_WORKER_OUT_OF_MEMORY when V8 terminates the worker cleanly (#L567), but V8 sometimes aborts the whole process instead (P7).", "evidence": ENG + "#L190-L198, #L453-L485, #L567"},
  {"topic": "State", "finding": "One pooled worker serves up to 500 runs (maxRunsPerWorker). After each run it deletes new globals and compares listed intrinsics; a leftover timer, undeletable global or touched intrinsic retires the worker. The process object is not checked, so state hung on it survives (P8). Concurrent execute() calls get throwaway workers.", "evidence": ENG + "#L136-L152, #L1273-L1300; " + O + "P8.txt"},
  {"topic": "Errors", "finding": "Caught in the worker and formatted as message plus stack (__fmtErr); execute() never rejects. Line numbers are user line + 3. The output limit applies to the error too and keeps the last lines, so a tight limit drops the message and keeps the stack tail (hardened P3).", "evidence": ENG + "#L928-L937; " + O + "hardened-P3.txt"},
  {"topic": "Credentials", "finding": "Actions run on the host with connections the guest cannot read via the bridge; an optional credentialBroker signs requests outside the plugin process and declared credentials are only sent to declared HTTPS targets. But the guest can read ~/.codemode or project config.json directly with require('fs'), which docs/security.md admits.", "evidence": GH + "docs/sdk.md (Sign requests in the host); " + GH + "docs/security.md (Protect credentials)"},
  {"topic": "Maintenance", "finding": "MIT license; pinned commit dated 2026-11-22; npm @shiftlabs/codemode 0.46.0 published 2026-11-21 from an older commit. Large bundled plugin set (200+ services).", "evidence": GH + "README.md"},
 ],
 "surprises": [
  "The default 64 MB memory limit is not containment: 7 of 24 runs of the literal P7 code aborted the whole host process with a V8 fatal OOM instead of terminating the worker (6 of 12 with an extra distinct-string variant). The engine's own doc comment promises the opposite: 'crash containment: a dead worker never takes the host process down' (packages/codemode/src/core/engine.ts:218).",
  "docs/security.md:17 says the worker keeps the host's environment variables away from calling code. process.env is empty, but ps eww on the shared PID printed the host's PROBE_SECRET in one line.",
  "fetch is 'disabled' only as a shadowed name: globalThis.fetch is Node's real fetch and reached example.com (200).",
  "The pooled worker's state scrub misses the process object: a property set on process in one run is visible to the next run, which may belong to another caller.",
  "The memory floor in code is 8 MB, but a worker cannot start below 12 MB; every run then fails with 'Memory limit exceeded'.",
  "The npm 0.46.0 tarball (gitHead 96683925) predates the pinned commit by 73 changed files in packages/codemode/src, including the whole output-limit feature that docs/sdk.md now documents.",
  "package.json keywords include \"sandbox\" and the fetch stub error says 'codemode sandbox', while the README and security doc say it is not a sandbox.",
 ],
}
out = here.parent / "results" / "shift-labs-codemode.json"
out.write_text(json.dumps(doc, indent=2) + "\n")
print("wrote", out)
