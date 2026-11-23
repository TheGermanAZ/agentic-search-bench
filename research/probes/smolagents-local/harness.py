"""Probe harness for smolagents LocalPythonExecutor (smolagents 1.26.0, tag v1.26.0 = 12c1bc8).

Runs P1..P12 through LocalPythonExecutor directly, the same class CodeAgent builds when
executor_type="local" (agents.py create_python_executor). No model is involved.

Usage (from this folder):
    ../../impls/smolagents-local/.venv/bin/python harness.py P1
    ../../impls/smolagents-local/.venv/bin/python harness.py P8 P11 P12

Each probe writes out/<P>.txt (raw evidence) and out/<P>.json (outcome summary).
Run through run_all.sh so each probe gets a fresh process: P6 and P7 leave a worker thread
running, and that would distort later timings.
"""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

from smolagents import LocalPythonExecutor, Tool  # noqa: E402

CALLS = {"n": 0}


class Lookup(Tool):
    name = "lookup"
    description = "Waits 200 ms, then returns {id, value: id * 2}. The probe counts host-side calls."
    inputs = {"id": {"type": "integer", "description": "The id to look up."}}
    output_type = "object"

    def forward(self, id: int):
        CALLS["n"] += 1
        time.sleep(0.2)
        return {"id": id, "value": id * 2}


def make_executor():
    ex = LocalPythonExecutor(additional_authorized_imports=[])
    ex.send_tools({"lookup": Lookup()})
    return ex


def attempt(ex, code):
    """Run one execution. Never raises: returns the raw result or the exception."""
    t0 = time.perf_counter()
    try:
        res = ex(code)
        return {
            "ok": True,
            "output": repr(res.output),
            "logs": res.logs,
            "is_final_answer": res.is_final_answer,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }
    except BaseException as e:  # noqa: BLE001 - we want every failure shape
        return {
            "ok": False,
            "error_type": type(e).__name__,
            "error": str(e),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }


def write(pid, raw_text, summary):
    (OUT / f"{pid}.txt").write_text(raw_text)
    (OUT / f"{pid}.json").write_text(json.dumps(summary, indent=2))


def header(pid, code):
    return f"probe: {pid}\ncode (python, run through LocalPythonExecutor):\n{code}\nhost_calls_so_far: {CALLS['n']}\n"


def peak_rss_bytes():
    """Peak RSS of this process in bytes (ru_maxrss is bytes on macOS, KB on Linux)."""
    import resource
    ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return ru if sys.platform == "darwin" else ru * 1024


def start_watchdog(pid, code, seconds, rss_limit_bytes=None):
    """Stop the probe process at `seconds`, or when peak RSS passes rss_limit_bytes.

    Used for P6 (120 s) and P7 (120 s or 4 GB). The worker thread cannot be killed from
    inside Python, so the watchdog writes the outcome and calls os._exit. Sampling is
    in-process (getrusage every 20 ms) because a ps subprocess per sample was too slow.
    """
    start = time.perf_counter()

    def loop():
        while True:
            time.sleep(0.02)
            elapsed = time.perf_counter() - start
            rss = peak_rss_bytes()
            if rss_limit_bytes is not None and rss >= rss_limit_bytes:
                summary = {
                    "probe": pid,
                    "outcome": "no-limit-within-120s",
                    "detail": (
                        f"no memory limit below {rss_limit_bytes / 1024**3:.0f} GB: harness stopped the process "
                        f"at {rss / 1024**3:.2f} GB peak RSS after {elapsed:.1f} s; no error from the executor"
                    ),
                    "killed_by": "harness RSS watchdog",
                    "peak_rss_gb": round(rss / 1024**3, 2),
                }
                write(pid, header(pid, code) + f"watchdog: peak RSS {rss} bytes after {elapsed:.1f} s, stopped\n", summary)
                print(json.dumps(summary), flush=True)
                os._exit(0)
            if elapsed >= seconds:
                summary = {
                    "probe": pid,
                    "outcome": "no-limit-within-120s",
                    "detail": f"no limit stopped the execution within {seconds} s",
                    "killed_by": "harness time watchdog",
                    "peak_rss_gb": round(rss / 1024**3, 2),
                }
                write(pid, header(pid, code) + f"watchdog: still running after {elapsed:.1f} s, stopped\n", summary)
                print(json.dumps(summary), flush=True)
                os._exit(0)

    threading.Thread(target=loop, daemon=True).start()


def probe_P1():
    code = "r = lookup(id=21)\nprint(r['value'])"
    ex = make_executor()
    before = CALLS["n"]
    r = attempt(ex, code)
    calls = CALLS["n"] - before
    ok = r["ok"] and r["logs"].strip() == "42" and calls == 1
    raw = header("P1", code) + f"result: {r}\n"
    summary = {
        "probe": "P1",
        "outcome": "works" if ok else "error",
        "detail": f"printed {r.get('logs', '').strip()!r}, {calls} host call" + ("" if calls == 1 else "s"),
        "wall_ms": r["ms"],
    }
    return raw, summary


def probe_P2():
    code = 'print("A" * 200000)\n"RETURNED"'
    ex = make_executor()
    r = attempt(ex, code)
    logs = r.get("logs", "")
    marker = "_This content has been truncated" in logs
    a_count = logs.count("A")
    raw = header("P2", 'print("A" * 200000)  then last expression "RETURNED"') + (
        f"ok: {r['ok']}\noutput (return value): {r.get('output')}\n"
        f"logs length: {len(logs)} chars, count of 'A' in logs: {a_count}\n"
        f"truncation marker present: {marker}\n"
        f"--- logs, full ---\n{logs}\n"
    )
    summary = {
        "probe": "P2",
        "outcome": "limited" if marker else ("works" if r["ok"] else "error"),
        "detail": (
            f"return value {r.get('output')} came back; print came back as {len(logs)} chars "
            f"({a_count} A's) with the truncation marker: {marker}"
        ),
        "logs_len": len(logs),
        "a_count": a_count,
        "truncation_marker": marker,
    }
    return raw, summary


def _simple(pid, code, blocked_substrings, note):
    ex = make_executor()
    r = attempt(ex, code)
    raw = header(pid, code) + f"result: {r}\n"
    if r["ok"]:
        outcome, detail = "works", f"ran; logs {r['logs']!r}"
    else:
        outcome = "blocked" if any(s in r["error"] for s in blocked_substrings) else "error"
        detail = f"{r['error_type']}: {r['error']}"
    summary = {"probe": pid, "outcome": outcome, "detail": detail + (f" ({note})" if note else ""), "wall_ms": r["ms"]}
    return raw, summary


def probe_P3():
    code = 'import urllib.request\nurllib.request.urlopen("https://example.com")'
    return _simple("P3", code, ["is not allowed"], "")


def probe_P4():
    code = 'open("/etc/hosts").read()'
    return _simple("P4", code, ["Forbidden function evaluation", "is not allowed"], "")


def probe_P4b():
    # Extra variant beyond SPEC: import-based read, as the spec's JS form suggests.
    code = 'import os\nprint(os.path.exists("/etc/hosts"))'
    return _simple("P4b", code, ["is not allowed"], "extra: import-based variant")


def probe_P5():
    code = 'import os\nprint(os.environ.get("PROBE_SECRET"))'
    return _simple("P5", code, ["is not allowed"], "")


def probe_P6():
    code = "while True:\n    pass"
    start_watchdog("P6", code, 120)
    ex = make_executor()
    r = attempt(ex, code)
    raw = header("P6", code) + f"result: {r}\n"
    if r["ok"]:
        outcome, detail = "works", "returned without error?"
    elif "maximum execution time" in r["error"]:
        outcome, detail = "limited", f"time limit: {r['error_type']}: {r['error']}"
    elif "Maximum number of" in r["error"] and "iterations" in r["error"]:
        outcome, detail = "limited", f"iteration cap, not the time limit: {r['error_type']}: {r['error']}"
    else:
        outcome, detail = "error", f"{r['error_type']}: {r['error']}"
    summary = {"probe": "P6", "outcome": outcome, "detail": detail, "wall_s": round(r["ms"] / 1000, 2)}
    return raw, summary


def probe_P6b():
    # Extra beyond SPEC: a finite 35 s sleep, to test whether the documented 30 s limit cuts the caller off at 30 s.
    code = "import time\ntime.sleep(35)\nprint('done')"
    start_watchdog("P6b", code, 120)
    ex = make_executor()
    r = attempt(ex, code)
    raw = header("P6b", code) + f"result: {r}\n"
    if r["ok"]:
        outcome, detail = "works", f"returned after {r['ms'] / 1000:.2f} s: {r['logs']!r}"
    else:
        outcome, detail = "limited", f"returned after {r['ms'] / 1000:.2f} s with {r['error_type']}: {r['error']}"
    summary = {"probe": "P6b", "outcome": outcome, "detail": detail, "wall_s": round(r["ms"] / 1000, 2)}
    return raw, summary


def probe_P7():
    code = 'a = []\nwhile True:\n    a.append("x" * 10**6)'
    start_watchdog("P7", code, 120, rss_limit_bytes=4 * 1024**3)
    ex = make_executor()
    r = attempt(ex, code)
    raw = header("P7", code) + f"result: {r}\n"
    peak_gb = round(peak_rss_bytes() / 1024**3, 2)
    if r["ok"]:
        outcome, detail = "works", "returned without error?"
    elif "Maximum number of" in r["error"] or "maximum execution time" in r["error"]:
        outcome, detail = "limited", f"{r['error_type']}: {r['error']}"
    elif "memory" in r["error"].lower():
        outcome, detail = "limited", f"{r['error_type']}: {r['error']}"
    else:
        outcome, detail = "error", f"{r['error_type']}: {r['error']}"
    summary = {"probe": "P7", "outcome": outcome, "detail": detail, "wall_s": round(r["ms"] / 1000, 2), "peak_rss_gb": peak_gb}
    return raw, summary


def probe_P8():
    ex = make_executor()
    first = attempt(ex, "kept = 7")
    second_code = (
        "try:\n"
        "    print(kept)\n"
        "except NameError:\n"
        "    print('gone')"
    )
    second = attempt(ex, second_code)
    state_has_kept = "kept" in ex.state
    persisted = second["ok"] and second["logs"].strip() == "7"
    raw = (
        header("P8", "execution 1: kept = 7\nexecution 2: try print(kept) except NameError print('gone')")
        + f"execution 1: {first}\nexecution 2: {second}\nexecutor.state has 'kept': {state_has_kept}\n"
        + f"executor.state['kept'] = {ex.state.get('kept')!r}\n"
    )
    summary = {
        "probe": "P8",
        "outcome": "persists" if persisted else "fresh",
        "detail": f"execution 2 printed {second.get('logs', '').strip()!r}; executor.state['kept'] = {ex.state.get('kept')!r}",
    }
    return raw, summary


def probe_P9():
    code = (
        "import time\n"
        "t = time.time()\n"
        "rs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
        "print(int((time.time() - t) * 1000))\n"
        "print(sum(r['value'] for r in rs))"
    )
    ex = make_executor()
    before = CALLS["n"]
    r = attempt(ex, code)
    calls = CALLS["n"] - before
    raw = header("P9", code) + f"result: {r}\nhost calls: {calls}\n"
    if r["ok"]:
        lines = r["logs"].split()
        ms = int(lines[0]) if lines else None
        verdict = "parallel" if ms is not None and ms < 500 else "serial"
        summary = {"probe": "P9", "outcome": "works", "detail": f"{verdict}: {ms} ms for 5 lookups (200 ms each), {calls} host calls, sum {lines[1] if len(lines) > 1 else '?'}"}
    else:
        summary = {"probe": "P9", "outcome": "error", "detail": f"{r['error_type']}: {r['error']}"}
    return raw, summary


def probe_P9b():
    # Extra variant beyond SPEC: asyncio, which the spec's Python form suggests if supported.
    code = "import asyncio"
    return _simple("P9b", code, ["is not allowed"], "extra: asyncio import, the spec's Python form")


def probe_P10():
    code = 'raise ValueError("probe-boom")'
    ex = make_executor()
    r = attempt(ex, code)
    raw = header("P10", code) + f"result: {r}\n"
    has_msg = "probe-boom" in r.get("error", "")
    import re
    has_line = bool(re.search(r"line \d+", r.get("error", "")))
    summary = {
        "probe": "P10",
        "outcome": "works" if (not r["ok"] and has_msg) else "error",
        "detail": f"{r.get('error_type')}: {r.get('error')!r}; message survives: {has_msg}; numeric line number present: {has_line} (the message quotes the failing statement instead)",
    }
    return raw, summary


def probe_P11():
    import statistics

    code = "print(2)"
    # Same executor, 20 executions.
    ex = make_executor()
    same = [attempt(ex, code)["ms"] for _ in range(20)]
    # Fresh executor per execution. Setup (construct + send_tools) is timed separately.
    fresh, setup = [], []
    for _ in range(20):
        t0 = time.perf_counter()
        e2 = make_executor()
        setup.append((time.perf_counter() - t0) * 1000)
        fresh.append(attempt(e2, code)["ms"])

    def stats(xs):
        xs = sorted(xs)
        p90 = xs[min(len(xs) - 1, int(round(0.9 * (len(xs) - 1))))]
        return {"median_ms": round(statistics.median(xs), 2), "p90_ms": round(p90, 2), "n": len(xs)}

    summary = {
        "probe": "P11",
        "outcome": "works",
        "detail": (
            f"same executor: {stats(same)}; fresh executor per run: {stats(fresh)}; "
            f"one-time setup (construct + send_tools): median {round(statistics.median(setup), 2)} ms"
        ),
        "same_executor": stats(same),
        "fresh_executor": stats(fresh),
        "setup_ms_median": round(statistics.median(setup), 2),
    }
    raw = header("P11", code) + f"same executor ms: {same}\nfresh executor ms: {fresh}\nsetup ms: {[round(s, 2) for s in setup]}\n"
    return raw, summary


ESCAPE_ATTEMPTS = [
    ("P12a spec: subclasses walk", "subs = ().__class__.__base__.__subclasses__()\nprint(len(subs))"),
    ("P12b spec: __import__ os system", '__import__("os").system("echo PWNED")'),
    # Extra beyond SPEC: reach os through an authorized stdlib module's non-dunder attributes.
    ("P12c extra: collections._sys.modules os", 'import collections\nr = collections._sys.modules["os"].system("echo PWNED")\nprint(r)'),
    ("P12d extra: queue.threading._os", 'import queue\nr = queue.threading._os.system("echo PWNED")\nprint(r)'),
]


def probe_P12():
    raw = header("P12", "\n\n".join(f"# {n}\n{c}" for n, c in ESCAPE_ATTEMPTS))
    lines, escaped_any, blocked_all = [], False, True
    for name, code in ESCAPE_ATTEMPTS:
        ex = make_executor()
        r = attempt(ex, code)
        raw += f"\n# {name}\nresult: {r}\n"
        if r["ok"] and ("PWNED" in code):
            escaped_any = True
            blocked_all = False
            lines.append(f"{name}: escaped, sandbox returned {r['logs'].strip()!r} (os.system exit status)")
        elif r["ok"]:
            blocked_all = False
            lines.append(f"{name}: ran, logs {r['logs'].strip()!r}")
        else:
            lines.append(f"{name}: {r['error_type']}: {r['error']}")
    outcome = "escaped" if escaped_any else ("blocked" if blocked_all else "error")
    summary = {"probe": "P12", "outcome": outcome, "detail": " | ".join(lines)}
    return raw, summary


PROBES = {
    "P1": probe_P1,
    "P2": probe_P2,
    "P3": probe_P3,
    "P4": probe_P4,
    "P4b": probe_P4b,
    "P5": probe_P5,
    "P6": probe_P6,
    "P6b": probe_P6b,
    "P7": probe_P7,
    "P8": probe_P8,
    "P9": probe_P9,
    "P9b": probe_P9b,
    "P10": probe_P10,
    "P11": probe_P11,
    "P12": probe_P12,
}


def main(argv):
    for pid in argv:
        raw, summary = PROBES[pid]()
        write(pid, raw, summary)
        print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
