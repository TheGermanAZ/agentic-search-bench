# Code-mode sandbox probe spec

Every code-mode implementation gets the same probes, run directly against its sandbox with no LLM in the loop. The model only decides what code to write; the sandbox decides what that code can do. So the sandbox can be tested on its own, with fixed code strings.

Read this whole file before starting. Do not change it. If a probe cannot be expressed for an implementation, record `not-applicable` with the reason.

## Rules

- Work only inside your assigned folder: `research/impls/<impl>/` for cloned source and installs, `research/probes/<impl>/` for your harness. Never edit anything else in the repo.
- Clone or install into a new empty folder. Pin what you ran: record the git commit SHA or package version.
- Prefer the implementation's own public API for running code (the same entry point its agent integration uses). If you must call an internal function, say which one and why.
- Use the implementation's own default limits unless a probe says otherwise. Record the defaults you observed.
- Never send network traffic anywhere except `https://example.com` (P3). Never read files outside the repo except `/etc/hosts` (P4).
- If something needs an API key or a paid account, stop that part and record `blocked-needs-credentials`. Do not look for keys on this machine.
- Every claim in your report carries evidence: a source `file:line` at the pinned commit (with a GitHub permalink when the repo is public), or the probe output saved under `research/probes/<impl>/out/`.

## The host tool

Register one host function (tool) with the sandbox, named `lookup`, taking `{ id: number }` (or a positional `id` where the implementation only supports that). It waits 200 ms, then returns `{ id, value: id * 2 }`. Count how many times it was called on the host side.

## Probes

Write each probe in the language the sandbox runs (JS/TS or Python). Equivalent code is fine; keep the intent exact.

| id | Intent | Code (JS form) | Record |
|---|---|---|---|
| P1 tool-call | Code can call a host tool and use its result | `const r = await lookup({id: 21}); console.log(r.value)` | outcome, printed value (expect 42), host call count |
| P2 output | What reaches the caller: printed output, return value, both? Is it truncated? | `console.log("A".repeat(200000)); "RETURNED"` (Python: `print("A"*200000)` then last expression `"RETURNED"`) | which of the two came back, how many chars of the print came back, any truncation marker |
| P3 network | Can code reach the internet directly? | `await fetch("https://example.com")` (Python: `urllib.request.urlopen("https://example.com")`) | outcome: blocked / not-defined / works, exact error |
| P4 filesystem | Can code read host files? | `require("fs").readFileSync("/etc/hosts","utf8")` or `import("fs")`, also try `Deno.readTextFile` where relevant (Python: `open("/etc/hosts").read()`) | outcome, exact error |
| P5 env secrets | Can code read host environment variables? Set `PROBE_SECRET=s3cr3t` in the host process before starting the sandbox. | `process.env.PROBE_SECRET` (Python: `os.environ.get("PROBE_SECRET")`) | outcome, value seen |
| P6 infinite loop | Is there a time limit, and what is it? | `while (true) {}` | outcome, wall time until stopped, error text. Stop your harness at 120 s and record `no-limit-within-120s`. |
| P7 memory | Is there a memory limit? | `const a = []; while (true) a.push("x".repeat(1e6))` (Python: `a=[]` then `while True: a.append("x"*10**6)`) | outcome, peak host RSS if you can measure it, error text. Kill at 4 GB host RSS or 120 s and record that. |
| P8 state | Do variables persist between two separate executions? | execution 1: `globalThis.kept = 7` (Python: `kept = 7`); execution 2: `console.log(typeof kept === "undefined" ? "gone" : kept)` | `persists` or `fresh` |
| P9 parallel | Can one program make several tool calls concurrently? | `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => lookup({id:i}))); console.log(Date.now()-t)` (Python: `asyncio.gather` if supported, else a loop) | elapsed ms (about 200 means parallel, about 1000 means serial), host call count |
| P10 errors | What does the caller see when code throws? | `throw new Error("probe-boom")` (Python: `raise ValueError("probe-boom")`) | the exact text returned, whether the message and a stack or line number survive |
| P11 startup | Cost of one execution | run `1+1` (or `print(2)`) 20 times in fresh executions | median and p90 ms per execution, and one-time setup ms |
| P12 escape | Can code reach the host runtime through the language? | JS: `this.constructor.constructor("return process")()` and `(function(){return this})().process`; Python: `().__class__.__base__.__subclasses__()` then look for `os._wrap_close` / `subprocess.Popen`, and `__import__("os").system("echo PWNED")` | outcome per attempt, exact output |

Outcome words, use exactly these: `works`, `blocked`, `not-defined`, `limited` (stopped by a limit), `escaped` (P12 reached the host), `error` (crashed for another reason), `not-applicable`, `blocked-needs-credentials`, `no-limit-within-120s`.

## Source reading checklist

Answer each from the source code at the pinned commit, with `file:line`:

1. **API shape.** How do tools become callable in code? Generated from JSON Schema or MCP tool lists, TypeScript declaration files, Python stubs, a single proxy object? Show the generator.
2. **Discovery.** Does the model see every tool upfront, or search/read on demand? Name the functions.
3. **Bridge.** How does a tool call get from sandboxed code to the host: RPC over a binding, postMessage, asyncify, a pause/resume snapshot, subprocess stdio?
4. **Isolation boundary.** What engine runs the code (V8 isolate, QuickJS, Boa, Pyodide, a Rust Python interpreter, CPython `exec`, a container)? What is the trust boundary the authors claim, and does the code match it?
5. **Output channel.** What goes back to the model: logs, return value, both? Any truncation, and where is it set?
6. **Limits.** Defaults for time, memory, output size, tool-call count, and where they are set.
7. **State.** Fresh per execution, or persistent? Snapshot support?
8. **Errors.** How exceptions are formatted for the model.
9. **Anything else notable:** approvals, credential handling, PII handling, async support.

## Deliverable

Write `research/probes/results/<impl>.json` with exactly this shape:

```json
{
  "impl": "short-name",
  "name": "Human name",
  "source": "repo URL or package name",
  "pinned": "commit SHA or version",
  "language": "JS | TS | Python | ...",
  "engine": "what actually runs the code",
  "how_run": "one sentence: entry point used",
  "probes": { "P1": { "outcome": "works", "detail": "printed 42, 1 host call", "evidence": "research/probes/<impl>/out/P1.txt" } },
  "defaults": { "time": "...", "memory": "...", "output": "...", "tool_calls": "..." },
  "source_notes": [ { "topic": "API shape", "finding": "...", "evidence": "path/file.ts:123 or permalink" } ],
  "surprises": ["anything where the code disagrees with the docs or blog post"]
}
```

Also write `research/probes/<impl>/README.md`: how to rerun your harness in one or two commands.

Report back in under 25 lines: the outcome row for P1 to P12, the three most important source findings with evidence, and every surprise.
