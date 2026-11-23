"""SPEC + RUBRIC probes for Pydantic AI Harness CodeMode (pydantic-ai-harness 0.71.0 on pydantic-monty 1.6.0).

Drives the real integration path: `Agent(FunctionModel(...), capabilities=[CodeMode(...)])`. The scripted
FunctionModel stands in for the LLM: it calls `run_code` with a fixed snippet, then reads back the tool
result the model would see. `lookup` is an ordinary `agent.tool_plain` that CodeMode folds into `run_code`.

Usage:
    PY=../../impls/pydantic-ai-harness-codemode/.venv/bin/python
    $PY harness.py P1 P2 ...                 # default CodeMode()
    $PY harness.py --hardened P3 P4 ...      # CodeMode(resource_limits=HARDENED, max_tool_calls=...)
    ../mem-lock.sh $PY harness.py P7         # memory probes go through the shared lock
Each probe runs in a child process; the parent kills the group at 120 s or 4 GiB summed tree RSS.
Writes out/[hardened-]<P>.txt and .json.
"""

import asyncio
import json
import os
import re
import signal
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
HARDENED_LIMITS = {"max_duration_seconds": 1.0, "max_memory": 10_000_000, "max_suspensions": 1000}
HARDENED = {"resource_limits": HARDENED_LIMITS, "max_tool_calls": 100}
CALLS = {"n": 0, "spans": []}


def build_agent(scripts, hardened, seen):
    """Agent whose scripted model calls run_code once per entry in `scripts`, then answers 'done'."""
    from pydantic_ai import Agent
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai_harness import CodeMode

    queue = list(scripts)

    def model(messages, info):
        seen["instructions"] = info.instructions
        seen["tools"] = [(t.name, t.description) for t in info.function_tools]
        last = messages[-1]
        for part in getattr(last, "parts", []):
            kind = type(part).__name__
            if kind in ("ToolReturnPart", "RetryPromptPart"):
                seen.setdefault("results", []).append({"kind": kind, "content": part.content if kind == "ToolReturnPart" else part.model_response()})
        if queue:
            return ModelResponse(parts=[ToolCallPart("run_code", {"code": queue.pop(0)})])
        return ModelResponse(parts=[TextPart("done")])

    cap = CodeMode(**HARDENED) if hardened else CodeMode()
    agent = Agent(FunctionModel(model), capabilities=[cap])

    @agent.tool_plain
    async def lookup(id: int) -> dict:
        """Waits 200 ms, then returns {id, value: id * 2}."""
        CALLS["n"] += 1
        t0 = time.perf_counter()
        await asyncio.sleep(0.2)
        CALLS["spans"].append((t0, time.perf_counter()))
        return {"id": id, "value": id * 2}

    return agent


def run_codes(codes, hardened=False):
    seen = {}
    agent = build_agent(codes, hardened, seen)
    t0 = time.perf_counter()
    try:
        agent.run_sync("probe")
        err = None
    except BaseException as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}"
    seen["wall_s"] = round(time.perf_counter() - t0, 3)
    seen["agent_error"] = err
    return seen


def result_text(seen, i=0):
    rs = seen.get("results", [])
    if i >= len(rs):
        return None
    c = rs[i]["content"]
    return c if isinstance(c, str) else json.dumps(c, default=str)


CODE = {
    "P1": "r = await lookup(id=21)\nprint(r['value'])",
    "P2": 'print("A" * 200000)\n"RETURNED"',
    "P3": 'import urllib.request\nurllib.request.urlopen("https://example.com")',
    "P4": 'open("/etc/hosts").read()',
    "P5": 'import os\nos.environ.get("PROBE_SECRET")',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    # time.time() is not available without os_access, so elapsed is measured on the host from lookup spans.
    "P9": ("import asyncio\n"
           "r = await asyncio.gather(*[lookup(id=i) for i in [1, 2, 3, 4, 5]])\n"
           "[x['value'] for x in r]"),
    "P10": 'raise ValueError("probe-boom")',
    "P12": [
        "print(().__class__.__base__.__subclasses__())",
        '__import__("os").system("echo PWNED")',
        "print(type(()).__mro__)",
        "print((lambda: 0).__globals__)",
        "import os\nos.system('echo PWNED')",
        "print(object.__subclasses__())",
        "import subprocess\nsubprocess.Popen(['echo', 'PWNED'])",
        "import sys\nprint(sys.modules)",
        "print(getattr((), '__class__'))",
    ],
    "X-print-cap": 'print("A" * 11_000_000)\n"RETURNED"',
    "X-tool-cap": "import asyncio\nr = await asyncio.gather(*[lookup(id=i) for i in range(101)])\nlen(r)",
    "X-suspensions": "import asyncio\nr = await asyncio.gather(*[lookup(id=i) for i in range(100)])\nlen(r)",
}


def probe(pid, hardened):
    CALLS["n"] = 0
    if pid == "P8":
        within = run_codes(["kept = 7", "print(kept)"], hardened)
        across_a = run_codes(["kept = 7"], hardened)
        across_b = run_codes(["print(kept)"], hardened)
        r_within, r_across = result_text(within, 1), result_text(across_b, 0)
        outcome = "persists" if r_within and "7" in r_within else "fresh"
        detail = f"second run_code in the same agent run saw: {r_within!r}; a new agent run saw: {r_across!r}"
        return outcome, detail, {"within": within, "across": across_b}
    if pid == "P11":
        t = time.perf_counter()
        first = run_codes(["1 + 1"], hardened)
        setup_ms = (time.perf_counter() - t) * 1000
        runs = []
        for _ in range(20):
            s = run_codes(["1 + 1"], hardened)
            assert result_text(s) is not None and "2" in result_text(s), s
            runs.append(s["wall_s"] * 1000)
        warm = run_codes(["1 + 1"] * 20, hardened)
        xs = sorted(runs)
        med, p90 = statistics.median(xs), xs[int(round(0.9 * (len(xs) - 1)))]
        detail = (f"fresh agent run with one run_code(1+1): median {med:.1f} ms, p90 {p90:.1f} ms (n=20); "
                  f"first run incl. imports and pool spawn {setup_ms:.0f} ms; 20 run_code calls in one run {warm['wall_s'] * 1000:.0f} ms total")
        return "works", detail, {"runs_ms": runs, "first": first.get("results"), "warm_total_s": warm["wall_s"]}
    if pid == "X-suspensions":
        s = run_codes([CODE[pid]] * 12, hardened)
        rs = [result_text(s, i) or "" for i in range(len(s.get("results", [])))]
        first_fail = next((i for i, r in enumerate(rs) if "Runtime error" in r or "limit" in r), None)
        outcome = "limited" if first_fail is not None else "works"
        detail = (f"12 snippets of 100 gathered lookups in one agent run: {CALLS['n']} host calls; "
                  f"first failing snippet index {first_fail}; its text {rs[first_fail][:600] if first_fail is not None else None!r}; "
                  f"agent_error {s['agent_error']!r}")
        return outcome, detail, {"results": rs, "agent_error": s["agent_error"]}
    if pid == "P12":
        attempts = []
        for code in CODE["P12"]:
            s = run_codes([code], hardened)
            attempts.append({"code": code, "when": "first snippet (ty type check on)", "result": result_text(s)})
            # _toolset.py:1429-1431 type-checks only the first snippet of a REPL, so a later snippet reaches Monty's runtime.
            s2 = run_codes(["warm = 1", code], hardened)
            attempts.append({"code": code, "when": "second snippet (no type check)", "result": result_text(s2, 1)})
        errored = lambda r: r.startswith(("Type error", "Runtime error", "Syntax error"))  # noqa: E731
        escaped = any(a["result"] and not errored(a["result"]) and any(m in a["result"] for m in ("Popen", "_wrap_close", "PWNED"))
                      for a in attempts)
        detail = " | ".join(f"[{a['when'][:6]}] {a['code'].splitlines()[-1]} -> {(a['result'] or '')[:160]}" for a in attempts)
        return ("escaped" if escaped else "blocked"), detail, attempts
    s = run_codes([CODE[pid]], hardened)
    txt = result_text(s) or ""
    kind = s.get("results", [{}])[0].get("kind") if s.get("results") else None
    if pid == "P1":
        outcome = "works" if "42" in txt and CALLS["n"] == 1 else "error"
        detail = f"model saw {txt!r} ({kind}), {CALLS['n']} host call"
    elif pid == "P2":
        a = txt.count("A")
        marker = [m for m in ("truncat", "omitted", "...") if m in txt.lower()]
        outcome = "works"
        detail = f"model saw {len(txt)} chars ({kind}), {a} 'A's, RETURNED present: {'RETURNED' in txt}, markers: {marker}, head {txt[:80]!r}, tail {txt[-120:]!r}"
    elif pid in ("P3", "P4", "P5"):
        if "s3cr3t" in txt or "localhost" in txt or "Example Domain" in txt or "200" in txt and pid == "P3":
            outcome = "works"
        elif "ModuleNotFoundError" in txt or "unresolved-import" in txt:
            outcome = "not-defined"
        else:
            outcome = "blocked"
        detail = f"model saw ({kind}): {txt[:400]!r}"
    elif pid in ("P6", "P7"):
        outcome = "limited" if ("time limit" in txt or "memory limit" in txt or "TimeoutError" in txt or "MemoryError" in txt) else "error"
        detail = f"stopped after {s['wall_s']:.2f} s agent-run wall; model saw ({kind}): {txt[:500]!r}"
        after = run_codes(["1 + 1"], hardened)
        detail += f"; host alive, next agent run returned {result_text(after)!r}"
    elif pid == "P9":
        sp = CALLS["spans"]
        span_ms = (max(e for _, e in sp) - min(b for b, _ in sp)) * 1000 if sp else None
        outcome = "works" if CALLS["n"] == 5 else "error"
        detail = (f"5 lookups spanned {span_ms:.0f} ms on the host (first start to last end; about 200 parallel, 1000 serial); "
                  f"model saw {txt!r} ({kind}); {CALLS['n']} host calls; agent-run wall {s['wall_s']:.2f} s")
    elif pid == "X-print-cap":
        outcome = "limited" if "MemoryError" in txt or "limit" in txt else "works"
        detail = f"model saw {len(txt)} chars ({kind}), {txt.count('A')} 'A's; text without the As: {txt.replace('A', '')[:600]!r}"
    elif pid == "X-tool-cap":
        outcome = "limited" if "nested tool calls" in txt else "works"
        detail = f"{CALLS['n']} host calls; model saw ({kind}): {txt[:900]!r}"
    elif pid == "P10":
        outcome = "works" if "probe-boom" in txt else "error"
        detail = f"model saw ({kind}): {txt!r}; line number present: {bool(re.search(r'line \d+', txt))}"
    return outcome, detail, s


def child(pid, hardened):
    os.environ["PROBE_SECRET"] = "s3cr3t"
    outcome, detail, raw = probe(pid, hardened)
    prefix = "hardened-" if hardened else ""
    cfg = f"CodeMode(**{HARDENED})" if hardened else "CodeMode()"
    (OUT / f"{prefix}{pid}.txt").write_text(
        f"config: {cfg}\ncode: {json.dumps(CODE.get(pid))}\noutcome: {outcome}\ndetail: {detail}\n\nraw:\n{json.dumps(raw, indent=2, default=str)}\n")
    (OUT / f"{prefix}{pid}.json").write_text(json.dumps({"probe": pid, "outcome": outcome, "detail": detail, "config": cfg}, indent=2))


def tree_rss_kb(root):
    ps = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    kids, rss = {}, {}
    for line in ps.splitlines():
        p, pp, r = map(int, line.split())
        kids.setdefault(pp, []).append(p)
        rss[p] = r
    total, stack = 0, [root]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total


def parent(pid, hardened):
    prefix = "hardened-" if hardened else ""
    path = OUT / f"{prefix}{pid}.json"
    path.unlink(missing_ok=True)
    args = [sys.executable, __file__, "--child", pid] + (["--hardened"] if hardened else [])
    proc = subprocess.Popen(args, start_new_session=True, env={**os.environ, "PROBE_SECRET": "s3cr3t"})
    start, peak, reason = time.monotonic(), 0, None
    while proc.poll() is None:
        kb = tree_rss_kb(proc.pid)
        peak = max(peak, kb)
        el = time.monotonic() - start
        reason = "120 s wall" if el > 120 else ("4 GiB tree RSS" if kb > 4 * 1024 * 1024 else None)
        if reason:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            break
        time.sleep(0.1)
    el = time.monotonic() - start
    if reason:
        res = {"probe": pid, "outcome": "no-limit-within-120s", "detail": f"harness killed the process group at {reason} after {el:.1f} s"}
        (OUT / f"{prefix}{pid}.txt").write_text(f"code: {json.dumps(CODE.get(pid))}\n{res['detail']}\n")
    elif path.exists():
        res = json.loads(path.read_text())
    else:
        res = {"probe": pid, "outcome": "error", "detail": f"child exited {proc.returncode} without a result"}
    res["peak_tree_rss_mib"] = round(peak / 1024)
    res["harness_wall_s"] = round(el, 2)
    path.write_text(json.dumps(res, indent=2))
    print(f"{prefix}{pid}\t{res['outcome']}\t{res['detail'][:600]}\tpeak {peak / 1024:.0f} MiB", flush=True)


if __name__ == "__main__":
    argv = sys.argv[1:]
    hardened = "--hardened" in argv
    argv = [a for a in argv if a != "--hardened"]
    if argv[0] == "--child":
        child(argv[1], hardened)
    else:
        for p in argv:
            parent(p, hardened)
