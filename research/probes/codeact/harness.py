"""Probe harness for CodeAct (xingyaoww/code-act, commit d607f56c9cfe9e8632ebaf65dcaf2b4b7fe1c6f8).

Runs P1..P12 through mint.tools.python_tool.PythonREPL, the executor that the agent integration builds in
mint/envs/general_env.py:66-70 (user_ns = {tool.name: tool.__call__}, then PythonREPL(user_ns=...)) and calls in
GeneralEnv.handle_tool_call (general_env.py:143). No model, no GPU, no Docker: the repo's Jupyter-gateway path
under scripts/chat/code_execution/ is not probed (it needs Docker or Kubernetes).

Usage (from this folder):
    ../../impls/codeact/.venv/bin/python harness.py P1
Each probe writes out/<P>.txt (raw evidence) and out/<P>.json (outcome summary).
"""

import json
import os
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

REPO = (HERE.parents[2] / "research" / "impls" / "codeact" / "repo").resolve()
# The clone is the code under test. Import it by absolute path. The interpreter's cwd stays in this probes folder.
sys.path.insert(0, str(REPO))

from mint.tools.python_tool import PythonREPL  # noqa: E402

CALLS = {"n": 0}


def lookup(id):
    """Host tool: waits 200 ms, returns {id, value: id * 2}."""
    CALLS["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


def make_repl(extra_ns=None):
    ns = {"lookup": lookup}
    ns.update(extra_ns or {})
    return PythonREPL(user_ns=ns)  # timeout defaults to 30 s, as in GeneralEnv


def attempt(repl, code):
    t0 = time.perf_counter()
    try:
        out = repl(code)
        return {"ok": True, "output": out, "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "error_type": type(e).__name__, "error": str(e), "ms": round((time.perf_counter() - t0) * 1000, 1)}


def write(pid, raw_text, summary):
    (OUT / f"{pid}.txt").write_text(raw_text)
    (OUT / f"{pid}.json").write_text(json.dumps(summary, indent=2))


def header(pid, code):
    return f"probe: {pid}\ncode (python, run through PythonREPL.__call__):\n{code}\nhost_calls_so_far: {CALLS['n']}\n"


def start_watchdog(pid, code, seconds, rss_limit_bytes=None):
    """Stop the process at `seconds`, or when peak RSS passes rss_limit_bytes. The repo's own 30 s alarm is
    SIGALRM, which we want to observe, so the harness watchdog only stops the run if that alarm does not fire."""
    import resource

    start = time.perf_counter()

    def peak():
        ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return ru if sys.platform == "darwin" else ru * 1024

    def loop():
        while True:
            time.sleep(0.02)
            elapsed = time.perf_counter() - start
            rss = peak()
            stop = None
            if rss_limit_bytes is not None and rss >= rss_limit_bytes:
                stop = f"harness stopped the process at {rss / 1024**3:.2f} GB peak RSS after {elapsed:.1f} s"
            elif elapsed >= seconds:
                stop = f"harness stopped the process after {seconds} s; no alarm stopped it"
            if stop:
                summary = {
                    "probe": pid,
                    "outcome": "no-limit-within-120s",
                    "detail": stop,
                    "killed_by": "harness watchdog",
                    "peak_rss_gb": round(rss / 1024**3, 2),
                }
                write(pid, header(pid, code) + f"watchdog: {stop}\n", summary)
                os.write(1, (json.dumps(summary) + "\n").encode())
                os._exit(0)

    threading.Thread(target=loop, daemon=True).start()


def probe_P1():
    code = "r = lookup(id=21)\nprint(r['value'])"
    repl = make_repl()
    before = CALLS["n"]
    r = attempt(repl, code)
    calls = CALLS["n"] - before
    ok = r["ok"] and r["output"].strip() == "42" and calls == 1
    raw = header("P1", code) + f"output: {r.get('output')!r}\n"
    return raw, {
        "probe": "P1",
        "outcome": "works" if ok else "error",
        "detail": f"printed {r.get('output', '').strip()!r}, {calls} host call" + ("" if calls == 1 else "s"),
        "wall_ms": r["ms"],
    }


def probe_P2():
    code = 'print("A" * 200000)\n"RETURNED"'
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "")
    marker = "[Output Truncated]" in out
    raw = header("P2", 'print("A" * 200000)  then last expression "RETURNED"') + (
        f"ok: {r['ok']}\nreturned string length: {len(out)} chars\n"
        f"RETURNED present: {'RETURNED' in out}\ntruncation marker present: {marker}\n"
        f"--- returned string, first 120 and last 160 chars ---\n{out[:120]}\n...\n{out[-160:]}\n"
    )
    a_count = out.count("A")
    return raw, {
        "probe": "P2",
        "outcome": "limited" if marker else ("works" if r["ok"] else "error"),
        "detail": (
            f"returned {len(out)} chars ({a_count} A's); truncation marker: {marker}; "
            f"'RETURNED' in returned text: {'RETURNED' in out} (the last expression's Out line is after the cut)"
        ),
        "returned_len": len(out),
        "returned_value_present": "RETURNED" in out,
    }


def probe_P3():
    code = 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)'
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "")
    ok = r["ok"] and out.strip() == "200"
    raw = header("P3", code) + f"ok: {r['ok']}\noutput: {out!r}\nerror: {r.get('error')}\n"
    return raw, {
        "probe": "P3",
        "outcome": "works" if ok else "error",
        "detail": f"printed HTTP status {out.strip()!r} from https://example.com" if ok else f"{r.get('error_type')}: {r.get('error')}; output {out[-200:]!r}",
    }


def probe_P4():
    code = 'print(open("/etc/hosts").read()[:60].replace("\\n", " | "))'
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "")
    ok = r["ok"] and "localhost" in out
    return header("P4", code) + f"output: {out!r}\n", {
        "probe": "P4",
        "outcome": "works" if ok else "error",
        "detail": f"read /etc/hosts: {out.strip()[:60]!r}" if ok else f"output {out[-200:]!r}",
    }


def probe_P5():
    code = 'import os\nprint(os.environ.get("PROBE_SECRET"))'
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "").strip()
    ok = r["ok"] and out == os.environ.get("PROBE_SECRET")
    return header("P5", code) + f"output: {r.get('output')!r}\n", {
        "probe": "P5",
        "outcome": "works" if ok else "error",
        "detail": f"sandbox printed {out!r}; host PROBE_SECRET is set",
    }


def probe_P6():
    code = "while True:\n    pass"
    start_watchdog("P6", code, 120)
    repl = make_repl()
    r = attempt(repl, code)  # returns once the repo's SIGALRM (30 s) fires inside the shell
    out = r.get("output", "")
    timed_out = "Timed out after 30 seconds" in out
    raw = header("P6", code) + f"ok: {r['ok']} after {r['ms'] / 1000:.2f} s\noutput: {out!r}\n"
    return raw, {
        "probe": "P6",
        "outcome": "limited" if timed_out else ("works" if r["ok"] else "error"),
        "detail": f"returned after {r['ms'] / 1000:.2f} s with the repo's message: {out.strip()!r}",
        "wall_s": round(r["ms"] / 1000, 2),
    }


def probe_P7():
    code = 'a = []\nwhile True:\n    a.append("x" * 10**6)'
    start_watchdog("P7", code, 120, rss_limit_bytes=4 * 1024**3)
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "")
    raw = header("P7", code) + f"ok: {r['ok']} after {r['ms'] / 1000:.2f} s\noutput tail: {out[-300:]!r}\n"
    limited = "Timed out after 30 seconds" in out
    return raw, {
        "probe": "P7",
        "outcome": "limited" if limited else "error",
        "detail": f"the 30 s alarm stopped it after {r['ms'] / 1000:.2f} s; no memory cap" if limited else f"{out[-200:]!r}",
        "wall_s": round(r["ms"] / 1000, 2),
    }


def probe_P8():
    repl = make_repl()
    first = attempt(repl, "kept = 7")
    second = attempt(repl, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
    persisted = second["ok"] and second.get("output", "").strip() == "7"
    raw = (
        header("P8", "execution 1: kept = 7\nexecution 2: try print(kept) except NameError print('gone')")
        + f"execution 1 output: {first.get('output')!r}\nexecution 2 output: {second.get('output')!r}\n"
        + f"repl.shell.user_ns['kept'] = {repl.shell.user_ns.get('kept')!r}\n"
    )
    return raw, {
        "probe": "P8",
        "outcome": "persists" if persisted else "fresh",
        "detail": f"execution 2 printed {second.get('output', '').strip()!r}; shell user_ns['kept'] = {repl.shell.user_ns.get('kept')!r}",
    }


P9_SERIAL = (
    "import time\n"
    "t = time.time()\n"
    "rs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
    "print(int((time.time() - t) * 1000))\n"
    "print(sum(r['value'] for r in rs))"
)


def probe_P9():
    repl = make_repl()
    before = CALLS["n"]
    r = attempt(repl, P9_SERIAL)
    calls = CALLS["n"] - before
    out = r.get("output", "")
    raw = header("P9", P9_SERIAL) + f"output: {out!r}\nhost calls: {calls}\n"
    if r["ok"] and out.split():
        ms = int(out.split()[0])
        verdict = "parallel" if ms < 500 else "serial"
        return raw, {"probe": "P9", "outcome": "works", "detail": f"{verdict}: {ms} ms for 5 lookups, {calls} host calls, sum {out.split()[1]}"}
    return raw, {"probe": "P9", "outcome": "error", "detail": out[-200:]}


P9B_THREADS = (
    "import time\n"
    "import concurrent.futures\n"
    "t = time.time()\n"
    "with concurrent.futures.ThreadPoolExecutor(5) as ex:\n"
    "    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\n"
    "print(int((time.time() - t) * 1000))\n"
    "print(sum(r['value'] for r in rs))"
)


def probe_P9b():
    repl = make_repl()
    before = CALLS["n"]
    r = attempt(repl, P9B_THREADS)
    calls = CALLS["n"] - before
    out = r.get("output", "")
    raw = header("P9b", P9B_THREADS) + f"output: {out!r}\nhost calls: {calls}\n"
    if r["ok"] and out.split():
        ms = int(out.split()[0])
        verdict = "parallel" if ms < 500 else "serial"
        return raw, {"probe": "P9b", "outcome": "works", "detail": f"extra: {verdict} via concurrent.futures: {ms} ms, {calls} host calls, sum {out.split()[1]}"}
    return raw, {"probe": "P9b", "outcome": "error", "detail": out[-200:]}


def probe_P10():
    code = 'raise ValueError("probe-boom")'
    repl = make_repl()
    r = attempt(repl, code)
    out = r.get("output", "")
    import re

    raw = header("P10", code) + f"ok: {r['ok']}\noutput: {out!r}\n"
    has_msg = "probe-boom" in out
    has_tb = "Traceback (most recent call last)" in out
    has_line = bool(re.search(r"line \d+", out))
    return raw, {
        "probe": "P10",
        "outcome": "works" if (r["ok"] and has_msg) else "error",
        "detail": f"returned as text, not raised: message {has_msg}; traceback {has_tb}; line number {has_line}. Text: {out.strip()[-160:]!r}",
    }


def probe_P11():
    import statistics

    code = "print(2)"
    repl = make_repl()
    same, bad = [], 0
    for _ in range(20):
        r = attempt(repl, code)
        same.append(r["ms"])
        bad += 0 if (r["ok"] and r["output"] == "2\n") else 1
    fresh, setup = [], []
    for _ in range(20):
        t0 = time.perf_counter()
        r2 = make_repl()
        setup.append((time.perf_counter() - t0) * 1000)
        rr = attempt(r2, code)
        fresh.append(rr["ms"])
        bad += 0 if (rr["ok"] and rr["output"] == "2\n") else 1

    def stats(xs):
        xs = sorted(xs)
        p90 = xs[min(len(xs) - 1, int(round(0.9 * (len(xs) - 1))))]
        return {"median_ms": round(statistics.median(xs), 2), "p90_ms": round(p90, 2), "n": len(xs)}

    summary = {
        "probe": "P11",
        "outcome": "works",
        "detail": (
            f"same PythonREPL: {stats(same)}; fresh PythonREPL per run (includes InteractiveShell reset): {stats(fresh)}; "
            f"runs whose output was not '2': {bad}; one-time construct: median {round(statistics.median(setup), 2)} ms"
        ),
        "outputs_not_2": bad,
        "same_repl": stats(same),
        "fresh_repl": stats(fresh),
        "construct_ms_median": round(statistics.median(setup), 2),
    }
    raw = header("P11", code) + f"same ms: {[round(x, 2) for x in same]}\nfresh ms: {[round(x, 2) for x in fresh]}\nconstruct ms: {[round(x, 2) for x in setup]}\n"
    return raw, summary


ESCAPE_ATTEMPTS = [
    ("P12a spec: subclasses walk", "subs = ().__class__.__base__.__subclasses__()\nprint(len(subs))"),
    ("P12b spec: __import__ os system", 'print(__import__("os").system("echo PWNED"))'),
    (
        "P12c spec: os._wrap_close globals -> system",
        "wc = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close']\n"
        "print(len(wc))\n"
        "print(wc[0].__init__.__globals__['system']('echo PWNED2'))",
    ),
]


def probe_P12():
    raw = header("P12", "\n\n".join(f"# {n}\n{c}" for n, c in ESCAPE_ATTEMPTS))
    lines, escaped = [], False
    for name, code in ESCAPE_ATTEMPTS:
        repl = make_repl()
        r = attempt(repl, code)
        out = r.get("output", "")
        raw += f"\n# {name}\nok={r['ok']} output={out!r} error={r.get('error')}\n"
        if r["ok"] and "PWNED" in code and out.strip().splitlines()[-1:] == ["0"]:
            escaped = True
            lines.append(f"{name}: escaped; os.system exit status printed as '0'")
        elif r["ok"]:
            lines.append(f"{name}: ran; output {out.strip()[:60]!r}")
        else:
            lines.append(f"{name}: {r.get('error_type')}: {r.get('error')}")
    return raw, {"probe": "P12", "outcome": "escaped" if escaped else "blocked", "detail": " | ".join(lines)}


PROBES = {
    "P1": probe_P1,
    "P2": probe_P2,
    "P3": probe_P3,
    "P4": probe_P4,
    "P5": probe_P5,
    "P6": probe_P6,
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
