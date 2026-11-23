"""Writes research/probes/results/codemode-unified-<runtime>.json for the five CodeMode Unified runtimes.

Outcome words and detail strings were written by hand from the reviewed out/ files under
research/probes/codemode-unified-<runtime>/out/. Check them against new output after any rerun.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHA = "6e4daa3e7ae17bf0764adeb5c72ba922c58b4d93"
GH = f"https://github.com/danieliser/codemode-unified/blob/{SHA}/"
SRV = GH + "src/mcp-server.ts"
BUN = GH + "src/runtime/bun-runtime.ts"
DENO = GH + "src/runtime/deno-runtime.ts"
QJS = GH + "src/sandbox/quickjs-runtime.ts"


def P(outcome, display, detail, evidence):
    return {"outcome": outcome, "detail": detail, "evidence": evidence, "display": display}


def ev(impl, name):
    return f"research/probes/{impl}/out/{name}.txt"


BUNDIR = "codemode-unified-bun"

SHARED_NOTES = [
    {"topic": "Bridge", "finding": "Not a live bridge but a two-pass replay. Pass 1 runs the whole program with every mcp.* call returning a placeholder string and logging '__MCP_CALL__' JSON; the server then runs all logged calls with Promise.all, bakes the results into the source as literals, and runs the whole program a second time. Arguments that depend on an earlier tool result are computed from the placeholder, and every side effect happens twice (P13).", "evidence": SRV + "#L903-L918; " + SRV + "#L946-L1021; " + SRV + "#L1111-L1134; " + ev(BUNDIR, "P13_twoPass")},
    {"topic": "API shape", "finding": "A generated `const mcp = { <server>: { <tool>: async (args) => __mcpCall('<server>.<tool>', args) } }` proxy is prepended to the program. Results come back wrapped as {content, text, parsed, isError, helpers}, so `r.value` is undefined and the value sits at r.parsed.value (P1).", "evidence": SRV + "#L403-L466; " + SRV + "#L974-L1007"},
    {"topic": "Discovery", "finding": "On-demand mode (the default) tells the model to read the resource mcp://types/declarations, but reading it always fails: loadTypeScriptDeclarations calls require() inside an ES module. The model gets no tool names. auto-include mode (CODEMODE_TYPE_EXPOSURE) lists every tool in the description instead.", "evidence": SRV + "#L35; " + SRV + "#L327-L340; " + SRV + "#L513-L529; " + ev(BUNDIR, "P15_discovery")},
    {"topic": "Setup", "finding": "Tool access is off unless CODEMODE_ENABLE_MCP_INTEGRATION=true, which the README does not mention. execute_code defaults to runtime 'quickjs', although the README recommends Bun.", "evidence": SRV + "#L1359; " + SRV + "#L879"},
    {"topic": "Credentials", "finding": "Tools run in the MCP server process, but on startup it prints the first 20 characters of every downstream MCP server env value with console.log, which goes to stdout, the MCP protocol channel.", "evidence": SRV + "#L281; " + ev(BUNDIR, "envlog-stdout")},
    {"topic": "Limits", "finding": "execute_code takes a timeout (default 30 s) and nothing else; getRuntime builds every runtime with only {type}, so the memoryLimit, Deno permission and E2B apiKey fields in RuntimeConfig cannot be set through the MCP server. No output cap, no tool-call cap.", "evidence": SRV + "#L502-L508; " + SRV + "#L879; " + SRV + "#L945"},
    {"topic": "HTTP mode", "finding": "The HTTP backend's /execute ignores the `runtime` field shown in the README curl example; its sandbox manager only wraps QuickJS.", "evidence": GH + "src/server.ts#L109-L128; " + GH + "src/sandbox/index.ts#L9-L19"},
    {"topic": "Maintenance", "finding": "27 commits, last on 2025-10-01, single author; package.json says MIT but the repo has no LICENSE file; not published to npm. The README badge says 'Production Ready'.", "evidence": "git log at " + SHA + "; npm view @danieliser/codemode-unified -> 404"},
]

common = {
    "source": "https://github.com/danieliser/codemode-unified",
    "pinned": SHA + " (2025-10-01)",
    "language": "JS/TS",
}
HOW = "MCP stdio server dist/mcp-server.js (CODEMODE_ENABLE_MCP_INTEGRATION=true, MCP_CONFIG_PATH naming a stdio MCP server that serves `lookup`), tool execute_code {code, runtime: '%s'}"

results = {}

# ---------------- Bun ----------------
i = "codemode-unified-bun"
results[i] = {
    "impl": i,
    "name": "CodeMode Unified, Bun runtime",
    **common,
    "engine": "A `bun run` subprocess per pass (Bun 1.4.4, JavaScriptCore), with the server's full environment and no permission flags",
    "how_run": HOW % "bun",
    "probes": {
        "P1": P("works", "works (r.value empty; r.parsed)", "spec code printed an empty line (r.value is undefined); 1 host call. r.parsed.value returned 42", ev(i, "P1")),
        "P2": P("works", "works (200,000 chars, no cap)", "full 200,000-char line in logs, no marker; the bare final expression is not returned, `return` works", ev(i, "P2")),
        "P3": P("works", "works (example.com 200)", "status 200, 577 bytes", ev(i, "P3")),
        "P4": P("works", "works (/etc/hosts read)", "require('fs'), import('fs') and Bun.file all read /etc/hosts", ev(i, "P4")),
        "P5": P("works", "works (s3cr3t)", "process.env.PROBE_SECRET returned s3cr3t: the bun child inherits the server's whole env", ev(i, "P5")),
        "P6": P("limited", "limited (30 s)", "'Bun execution timeout' after 30,021 ms (SIGTERM to the bun process)", ev(i, "P6")),
        "P7": P("no-limit-within-120s", "no cap (4 GB kill at 0.9 s)", "no memory limit; process tree passed 4 GB host RSS 0.85 s after start and the harness killed it", ev(i, "P7")),
        "P8": P("works", "fresh", "second run returned gone (new process per pass)", ev(i, "P8")),
        "P9": P("works", "parallel (269 ms, replayed)", "5 host calls, 269 ms wall: the server resolves logged calls with Promise.all. The in-code timer printed 0 ms because pass 2 reads baked-in results", ev(i, "P9")),
        "P10": P("works", "message + temp-file line (+29)", "'Bun exited with code 1: EXECUTION_ERROR: probe-boom' plus a stack at bun-exec-<id>.ts:30:11; user line 1 shows as line 30, line 3 as 32", ev(i, "P10")),
        "P11": P("works", "18.7 ms median", "median 18.7 ms, p90 28.5 ms; first run 52 ms; server setup 280 ms. `1+1` returns no value: auto-return is skipped once the injected proxy contains 'return '", ev(i, "P11")),
        "P12": P("escaped", "escaped (child_process, Bun.spawn)", "child_process.execSync and Bun.spawnSync printed PWNED and the host user name; the spec one-liners fail only because `this` is undefined in the wrapper", ev(i, "P12")),
    },
    "hardened": {
        "config": "execute_code argument timeout: 5000, the only limit the MCP entry point exposes (" + SRV + "#L548-L551, #L879)",
        "probes": {
            "P3": P("works", "works (example.com 200)", "same as default", ev(i, "hardened-P3")),
            "P4": P("works", "works (/etc/hosts read)", "same as default", ev(i, "hardened-P4")),
            "P5": P("works", "works (s3cr3t)", "same as default", ev(i, "hardened-P5")),
            "P6": P("limited", "limited (5 s)", "'Bun execution timeout' after 5,025 ms", ev(i, "hardened-P6")),
            "P7": P("no-limit-within-120s", "no cap (4 GB kill at 1.0 s)", "passed 4 GB host RSS 1.0 s after start, before the 5 s timeout; harness kill", ev(i, "hardened-P7")),
            "P9": P("works", "parallel (278 ms, replayed)", "5 host calls", ev(i, "hardened-P9")),
            "P12": P("escaped", "escaped (child_process, Bun.spawn)", "same as default", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s per pass (execute_code timeout), then SIGTERM", "memory": "none", "output": "no cap", "tool_calls": "no cap"},
    "source_notes": [
        {"topic": "Isolation boundary", "finding": "Writes the wrapped program to $TMPDIR/bun-exec-<id>.ts and spawns bun with no env option, so the child inherits the server's whole environment, and with no permission model. capabilities() still reports hasNativeIsolation: true.", "evidence": BUN + "#L68-L78; " + BUN + "#L292; " + BUN + "#L158"},
        {"topic": "Credentials (measured)", "finding": "Program code read MCP_CONFIG_PATH from env and then the config file itself, which holds every downstream MCP server's command and env.", "evidence": ev(i, "P14_credentials")},
        {"topic": "Runtime path", "finding": "Uses $HOME/.bun/bin/bun whenever HOME is set, without checking that it exists; the 'bun' PATH fallback is unreachable.", "evidence": BUN + "#L38-L41"},
    ] + SHARED_NOTES,
    "surprises": [
        "Tool calls are replayed, not bridged: the program runs twice, and a call whose arguments depend on an earlier result gets the placeholder's value (lookup(a.parsed.value) was called with id -1 and returned {id: -1, value: -2}).",
        "A file-append side effect in a program with one tool call happened twice.",
        "The model is told to read mcp://types/declarations, which always errors, so in the default mode it cannot learn the tool names.",
        "README says 'Sandboxed execution with memory/CPU limits' and 'Network access controls'; the Bun runtime has neither, and reads host files, env and runs shell commands.",
        "Default runtime is quickjs, not the recommended Bun.",
    ],
}

# ---------------- Deno ----------------
i = "codemode-unified-deno"
results[i] = {
    "impl": i,
    "name": "CodeMode Unified, Deno runtime",
    **common,
    "engine": "A `deno run --allow-net --no-prompt` subprocess per pass (Deno 2.9.8, V8)",
    "how_run": (HOW % "deno") + "; HOME pointed at a folder with .deno/bin/deno symlinked to the installed deno, because the runtime only looks there",
    "probes": {
        "P1": P("works", "works (r.value empty; r.parsed)", "spec code printed an empty line; 1 host call; r.parsed.value returned 42", ev(i, "P1")),
        "P2": P("works", "works (200,000 chars, no cap)", "full 200,000-char line, no marker; result only with `return`", ev(i, "P2")),
        "P3": P("works", "works (example.com 200)", "status 200: --allow-net is hard-coded", ev(i, "P3")),
        "P4": P("blocked", "blocked (no --allow-read)", "NotCapable: Requires read access to \"/etc/hosts\", run again with the --allow-read flag (node:fs and Deno.readTextFile)", ev(i, "P4")),
        "P5": P("blocked", "blocked (no --allow-env)", "NotCapable: Requires env access to \"PROBE_SECRET\"", ev(i, "P5")),
        "P6": P("limited", "limited (30 s)", "'Deno execution timeout' after 30,022 ms", ev(i, "P6")),
        "P7": P("no-limit-within-120s", "no cap (4 GB kill at 11.7 s)", "no memory limit; tree passed 4 GB host RSS at 11.7 s and the harness killed it", ev(i, "P7")),
        "P8": P("works", "fresh", "second run returned gone", ev(i, "P8")),
        "P9": P("works", "parallel (414 ms, replayed)", "5 host calls, 414 ms wall across both passes; in-code timer printed 0 ms", ev(i, "P9")),
        "P10": P("works", "message + temp-file line (+29)", "'Deno exited with code 1: EXECUTION_ERROR: probe-boom' with a stack at deno-exec-<id>.ts:30:7", ev(i, "P10")),
        "P11": P("works", "34.9 ms median", "median 34.9 ms, p90 47.6 ms; first run 55 ms; server setup 314 ms", ev(i, "P11")),
        "P12": P("blocked", "blocked (no --allow-run/env)", "child_process: Requires env access; Deno.Command: Requires run access to \"sh\"; this.constructor fails (this undefined)", ev(i, "P12")),
    },
    "hardened": {
        "config": "execute_code argument timeout: 5000 (" + SRV + "#L879); Deno permissions cannot be changed through the MCP server",
        "probes": {
            "P3": P("works", "works (example.com 200)", "same as default", ev(i, "hardened-P3")),
            "P4": P("blocked", "blocked (no --allow-read)", "same as default", ev(i, "hardened-P4")),
            "P5": P("blocked", "blocked (no --allow-env)", "same as default", ev(i, "hardened-P5")),
            "P6": P("limited", "limited (5 s)", "'Deno execution timeout' after 5,024 ms", ev(i, "hardened-P6")),
            "P7": P("limited", "limited (5 s timeout, no mem cap)", "stopped by the 5 s timeout at 3.3 GB tree RSS; next execution returned 2", ev(i, "hardened-P7")),
            "P9": P("works", "parallel (294 ms, replayed)", "5 host calls", ev(i, "hardened-P9")),
            "P12": P("blocked", "blocked (no --allow-run/env)", "same as default", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s per pass, then SIGTERM", "memory": "none (Deno's own V8 heap limit only)", "output": "no cap", "tool_calls": "no cap"},
    "source_notes": [
        {"topic": "Isolation boundary", "finding": "Deno's permission flags are the boundary: --allow-net and --no-prompt always; read, write and env only when ExecutionOptions.permissions asks, which the MCP server never passes.", "evidence": DENO + "#L202-L222"},
        {"topic": "Runtime path", "finding": "Uses $HOME/.deno/bin/deno whenever HOME is set, without checking it exists; a deno installed elsewhere (Homebrew here) fails initialisation with 'Deno not found'.", "evidence": DENO + "#L38-L41; " + DENO + "#L44-L52"},
    ] + SHARED_NOTES,
    "surprises": [
        "Network is always on (--allow-net with no host list), so code can reach any host, including services on localhost.",
        "Same two-pass replay as Bun: a dependent tool call got the placeholder's value (id -1).",
        "The runtime looks only at ~/.deno/bin/deno, so a Homebrew deno is not found.",
    ],
}

# ---------------- QuickJS ----------------
i = "codemode-unified-quickjs"
results[i] = {
    "impl": i,
    "name": "CodeMode Unified, QuickJS runtime (the default runtime)",
    **common,
    "engine": "QuickJS WASM (quickjs-emscripten 0.23) in the MCP server process; a pool of reused contexts with no memory or interrupt limits",
    "how_run": (HOW % "quickjs") + ". Probes run in the script form this runtime accepts (last expression is the result; no await, return or console), most on a new server each, because a reused context rejects every program after the first",
    "probes": {
        "P1": P("error", "error (no await/console; 0 calls)", "spec code: SyntaxError: expecting ';' (no top-level await). Expression form returned {} with 0 host calls: the injected __mcpCall uses console.log, which is not defined, and supportsAsync is false", ev(i, "P1")),
        "P2": P("limited", "return only (200,000; no console)", "console is not defined, so nothing can be printed; the last-expression value came back whole at 200,000 chars", ev(i, "P2")),
        "P3": P("not-defined", "not-defined", "'fetch' is not defined", ev(i, "P3")),
        "P4": P("not-defined", "not-defined", "'require' is not defined; import('fs') evaluates to an unresolved promise ({}); Deno, Bun, std, os undefined", ev(i, "P4")),
        "P5": P("not-defined", "not-defined", "'process' is not defined", ev(i, "P5")),
        "P6": P("no-limit-within-120s", "host hang (no limit, 120 s)", "evalCode is synchronous with no interrupt handler, so the 30 s setTimeout can never fire; the whole MCP server hung until the harness killed it at 120 s", ev(i, "P6")),
        "P7": P("limited", "limited (WASM ~2 GB ceiling)", "InternalError: out of memory after 5.8 s at 2.25 GB tree RSS; no limit is configured, the WASM heap ran out. The server answered the next call", ev(i, "P7")),
        "P8": P("works", "persists (breaks next run)", "with MCP off, the second run returned kept = 7. With MCP on, the second run fails: SyntaxError: redeclaration of '__mcpCallCounter', from the injected const left in the reused context", ev(i, "P8")),
        "P9": P("error", "error (no tool calls possible)", "Promise.all of five calls returned {} with 0 host calls", ev(i, "P9")),
        "P10": P("works", "message only (no line)", "error.message 'Error: probe-boom'; no line (e.stack inside the guest shows eval.js:19)", ev(i, "P10")),
        "P11": P("works", "0.5 ms (1st run only w/ MCP)", "MCP off: median 0.5 ms, p90 2.1 ms, first 30 ms, setup 170 ms. MCP on: run 1 returned 2, runs 2 to 4 failed with the redeclaration error", ev(i, "P11")),
        "P12": P("blocked", "blocked", "Function constructor: typeof process is undefined; sloppy this.process undefined", ev(i, "P12")),
    },
    "hardened": {
        "config": "execute_code argument timeout: 5000 (" + SRV + "#L879)",
        "probes": {
            "P3": P("not-defined", "not-defined", "same as default", ev(i, "hardened-P3")),
            "P4": P("not-defined", "not-defined", "same as default", ev(i, "hardened-P4")),
            "P5": P("not-defined", "not-defined", "same as default", ev(i, "hardened-P5")),
            "P6": P("no-limit-within-120s", "host hang (no limit, 120 s)", "timeout 5000 has no effect on a synchronous loop; server hung until the 120 s harness kill", ev(i, "hardened-P6")),
            "P7": P("limited", "limited (WASM ~2 GB ceiling)", "out of memory after 5.8 s at 2.2 GB", ev(i, "hardened-P7")),
            "P9": P("error", "error (no tool calls possible)", "0 host calls", ev(i, "hardened-P9")),
            "P12": P("blocked", "blocked", "same as default", ev(i, "hardened-P12")),
        },
    },
    "defaults": {"time": "30 s setTimeout that cannot interrupt synchronous evaluation", "memory": "none configured", "output": "no cap", "tool_calls": "not possible (console missing, no async)"},
    "source_notes": [
        {"topic": "Isolation boundary", "finding": "Contexts come from one shared WASM module, are pooled (max(2, cpus/2)) and reused for up to 100 executions; the security configuration methods are empty ('No configuration for now - minimal test').", "evidence": QJS + "#L29-L35; " + QJS + "#L125-L143; " + QJS + "#L164-L189"},
        {"topic": "Limits", "finding": "evalCode runs synchronously inside a Promise whose timeout is a setTimeout; no interrupt handler or memory limit is set, so neither time nor memory is bounded by the implementation.", "evidence": QJS + "#L196-L223"},
        {"topic": "Language", "finding": "The adapter declares supportsAsync false, and the code is evaluated as a global script, so `await`, top-level `return` and console are unavailable; the MCP prelude that relies on console.log therefore fails.", "evidence": GH + "src/runtime/quickjs-runtime.ts#L61-L71; " + QJS + "#L223"},
    ] + SHARED_NOTES,
    "surprises": [
        "The default runtime cannot call tools at all: the injected bridge needs console.log and await, which this runtime lacks.",
        "After one successful run, every later run in the same pooled context fails with 'redeclaration of __mcpCallCounter'.",
        "A `while (true) {}` hangs the whole MCP server; the timeout argument does nothing.",
    ],
}

# ---------------- isolated-vm and E2B: stubs ----------------
for rt, name, msg, src in [
    ("isolated-vm", "CodeMode Unified, isolated-vm runtime", "isolated-vm runtime not yet implemented", GH + "src/runtime/isolated-vm-runtime.ts#L22-L32"),
    ("e2b", "CodeMode Unified, E2B runtime", "E2B runtime requires apiKey in config", GH + "src/runtime/e2b-runtime.ts#L17-L35"),
]:
    i = f"codemode-unified-{rt}"
    probes = {f"P{n}": P("not-applicable", "not implemented (stub)", f"every execute_code call returned the error '{msg}'; the runtime is a stub", ev(i, f"P{n}")) for n in range(1, 13)}
    notes = [
        {"topic": "Not implemented", "finding": f"The {rt} adapter is a TODO stub: execute() throws '{('E2B' if rt == 'e2b' else 'isolated-vm')} runtime not yet implemented'." + (" Its constructor also throws without e2b.apiKey, and the MCP server never passes one, so via MCP it fails before that. Credentials were not needed to establish this." if rt == "e2b" else " isolated-vm is not even a dependency in package.json."), "evidence": src + "; " + GH + "package.json"},
    ] + SHARED_NOTES
    results[i] = {
        "impl": i,
        "name": name,
        **common,
        "engine": "none: the adapter is a stub",
        "how_run": HOW % rt,
        "probes": probes,
        "hardened": None,
        "defaults": {"time": "n/a", "memory": "n/a", "output": "n/a", "tool_calls": "n/a", "note": "hardened is null: the runtime does not exist"},
        "source_notes": notes,
        "surprises": ["README lists " + rt + " among the supported runtimes with startup figures, but the adapter is a stub."],
    }

out_dir = ROOT / "research/probes/results"
for impl, data in results.items():
    (out_dir / f"{impl}.json").write_text(json.dumps(data, indent=2) + "\n")
    print("wrote", impl)
