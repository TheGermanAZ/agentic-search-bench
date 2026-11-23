"""Probe harness for alexzhang13/rlm LocalREPL (rlm 0.1.3, commit e11f1a8f8ee4490686e16dd6463233abe08a07eb).

Runs P1..P12 directly through LocalREPL.execute_code(), the same call rlm/core/rlm.py makes at
rlm.py:757. No LLM is involved: lm_handler_address is None, and llm_query is replaced with a stub
that counts calls. The RLM class itself is never constructed, so no model client is needed.

Usage (from this folder):
    ../../impls/rlm/.venv/bin/python harness.py P1
    ../../impls/rlm/.venv/bin/python harness.py CTX P2

Each probe writes out/<P>.txt (raw evidence) and out/<P>.json (outcome summary). run_all.sh runs
each probe in its own process, because P6 and P7 keep running until a watchdog stops them.
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

from rlm.core.types import CodeBlock, RLMIteration  # noqa: E402
from rlm.environments.local_repl import LocalREPL  # noqa: E402
from rlm.utils.parsing import format_iteration  # noqa: E402

CALLS = {"n": 0}
LLM_STUB_CALLS = {"n": 0}


def lookup(id):
    """Host tool: waits 200 ms, returns {id, value: id * 2}."""
    CALLS["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


def llm_query_stub(prompt, model=None):
    LLM_STUB_CALLS["n"] += 1
    return "STUB-LLM-RESPONSE"


def make_env(context_payload=None):
    env = LocalREPL(lm_handler_address=None, context_payload=context_payload, custom_tools={"lookup": lookup})
    env.globals["llm_query"] = llm_query_stub  # overridden after every cell by _restore_scaffold, so set it per call too
    return env


def run_cell(env, code):
    """Run one cell through execute_code. Never raises."""
    env.globals["llm_query"] = llm_query_stub
    t0 = time.perf_counter()
    try:
        res = env.execute_code(code)
        return {
            "ok": True,
            "stdout": res.stdout,
            "stderr": res.stderr,
            "final_answer": res.final_answer,
            "exec_s": round(res.execution_time, 4),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "result": res,
        }
    except BaseException as e:  # noqa: BLE001
        return {
            "ok": False,
            "error_type": type(e).__name__,
            "error": str(e),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }


def model_view(res):
    """What the model sees for one cell: rlm/utils/parsing.py format_iteration (per-block cap 20000)."""
    it = RLMIteration(prompt="probe", response="", code_blocks=[CodeBlock(code="", result=res)])
    msgs = format_iteration(it)
    return msgs[-1]["content"] if len(msgs) > 1 else ""


def write(pid, raw_text, summary):
    (OUT / f"{pid}.txt").write_text(raw_text)
    (OUT / f"{pid}.json").write_text(json.dumps(summary, indent=2))


def header(pid, code):
    return f"probe: {pid}\ncode (python, run through LocalREPL.execute_code):\n{code}\nhost_calls_so_far: {CALLS['n']}\n"


def peak_rss_bytes():
    import resource

    ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return ru if sys.platform == "darwin" else ru * 1024


def start_watchdog(pid, code, seconds, rss_limit_bytes=None):
    """Stop the process at `seconds`, or when peak RSS passes rss_limit_bytes (see smolagents harness)."""
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
                        f"at {rss / 1024**3:.2f} GB peak RSS after {elapsed:.1f} s; no error from the REPL"
                    ),
                    "killed_by": "harness RSS watchdog",
                    "peak_rss_gb": round(rss / 1024**3, 2),
                }
                write(pid, header(pid, code) + f"watchdog: peak RSS {rss} bytes after {elapsed:.1f} s, stopped\n", summary)
                os.write(1, (json.dumps(summary) + '\n').encode())
                os._exit(0)
            if elapsed >= seconds:
                summary = {
                    "probe": pid,
                    "outcome": "no-limit-within-120s",
                    "detail": f"no limit stopped the cell within {seconds} s; harness stopped it",
                    "killed_by": "harness time watchdog",
                    "peak_rss_gb": round(rss / 1024**3, 2),
                }
                write(pid, header(pid, code) + f"watchdog: still running after {elapsed:.1f} s, stopped\n", summary)
                os.write(1, (json.dumps(summary) + '\n').encode())
                os._exit(0)

    threading.Thread(target=loop, daemon=True).start()


def probe_P1():
    code = "r = lookup(id=21)\nprint(r['value'])"
    env = make_env()
    before = CALLS["n"]
    r = run_cell(env, code)
    calls = CALLS["n"] - before
    ok = r["ok"] and r["stdout"].strip() == "42" and calls == 1
    raw = header("P1", code) + f"stdout: {r.get('stdout')!r}\nstderr: {r.get('stderr')!r}\n"
    summary = {
        "probe": "P1",
        "outcome": "works" if ok else "error",
        "detail": f"printed {r.get('stdout', '').strip()!r}, {calls} host call" + ("" if calls == 1 else "s"),
        "wall_ms": r["ms"],
    }
    return raw, summary


def probe_P2():
    code = 'print("A" * 200000)\n"RETURNED"'
    env = make_env()
    r = run_cell(env, code)
    stdout = r.get("stdout", "")
    view = model_view(r["result"]) if r["ok"] else ""
    marker_in_view = "chars...]" in view
    raw = header("P2", 'print("A" * 200000)  then last expression "RETURNED"') + (
        f"ok: {r['ok']}\n"
        f"stdout length from execute_code: {len(stdout)} chars (no truncation at this layer)\n"
        f"stderr: {r.get('stderr')!r}\n"
        f"final_answer: {r.get('final_answer')!r}\n"
        f"RETURNED present in stdout: {'RETURNED' in stdout}\n"
        f"model-facing text length (format_iteration): {len(view)} chars; truncation marker present: {marker_in_view}\n"
        f"--- model-facing text, first 200 and last 200 chars ---\n{view[:200]}\n...\n{view[-200:]}\n"
    )
    summary = {
        "probe": "P2",
        "outcome": "limited" if marker_in_view else ("works" if r["ok"] else "error"),
        "detail": (
            f"execute_code returned {len(stdout)} chars of stdout with no cap; the last expression "
            f"'RETURNED' is not returned (exec drops it). format_iteration cuts the model view to "
            f"{len(view)} chars with a head-only marker: {marker_in_view}"
        ),
        "stdout_len": len(stdout),
        "model_view_len": len(view),
        "returned_value_present": "RETURNED" in stdout,
    }
    return raw, summary


def probe_P3():
    code = 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)'
    env = make_env()
    r = run_cell(env, code)
    ok = r["ok"] and not r.get("stderr")
    raw = header("P3", code) + f"stdout: {r.get('stdout')!r}\nstderr: {r.get('stderr')!r}\nerror: {r.get('error')}\n"
    if ok:
        outcome, detail = "works", f"printed HTTP status {r['stdout'].strip()} from https://example.com"
    else:
        outcome, detail = "error", f"{r.get('error_type')}: {r.get('error')} / stderr {r.get('stderr')!r}"
    return raw, {"probe": "P3", "outcome": outcome, "detail": detail}


def probe_P4():
    code = 'print(open("/etc/hosts").read()[:60].replace("\\n", " | "))'
    env = make_env()
    r = run_cell(env, code)
    ok = r["ok"] and not r.get("stderr") and "localhost" in r.get("stdout", "")
    raw = header("P4", code) + f"stdout: {r.get('stdout')!r}\nstderr: {r.get('stderr')!r}\n"
    outcome = "works" if ok else "error"
    detail = f"read /etc/hosts: {r.get('stdout', '').strip()[:60]!r}" if ok else f"stderr {r.get('stderr')!r}"
    return raw, {"probe": "P4", "outcome": outcome, "detail": detail}


def probe_P5():
    code = 'import os\nprint(os.environ.get("PROBE_SECRET"))'
    env = make_env()
    r = run_cell(env, code)
    seen = r.get("stdout", "").strip()
    outcome = "works" if seen == os.environ.get("PROBE_SECRET") else ("error" if not r["ok"] else "blocked")
    raw = header("P5", code) + f"stdout: {r.get('stdout')!r}\nstderr: {r.get('stderr')!r}\n"
    return raw, {"probe": "P5", "outcome": outcome, "detail": f"sandbox printed {seen!r}; host PROBE_SECRET is set"}


def probe_P6():
    code = "while True:\n    pass"
    start_watchdog("P6", code, 120)
    env = make_env()
    r = run_cell(env, code)  # only reached if the cell returns
    raw = header("P6", code) + f"result: {r}\n"
    return raw, {"probe": "P6", "outcome": "limited", "detail": "cell returned; see raw"}


def probe_P7():
    code = 'a = []\nwhile True:\n    a.append("x" * 10**6)'
    start_watchdog("P7", code, 120, rss_limit_bytes=4 * 1024**3)
    env = make_env()
    r = run_cell(env, code)
    raw = header("P7", code) + f"result: {r}\n"
    return raw, {"probe": "P7", "outcome": "limited", "detail": "cell returned; see raw"}


def probe_P8():
    env = make_env()
    first = run_cell(env, "kept = 7")
    second = run_cell(env, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
    persisted = second["ok"] and second.get("stdout", "").strip() == "7"
    raw = (
        header("P8", "execution 1: kept = 7\nexecution 2: try print(kept) except NameError print('gone')")
        + f"execution 1 stdout={first.get('stdout')!r} stderr={first.get('stderr')!r}\n"
        + f"execution 2 stdout={second.get('stdout')!r} stderr={second.get('stderr')!r}\n"
        + f"env.locals has kept: {'kept' in env.locals}; persistent flag: {env.persistent}\n"
    )
    summary = {
        "probe": "P8",
        "outcome": "persists" if persisted else "fresh",
        "detail": f"execution 2 printed {second.get('stdout', '').strip()!r}; env.locals['kept'] = {env.locals.get('kept')!r} (persistent={env.persistent})",
    }
    return raw, summary


P9_SERIAL = (
    "import time\n"
    "t = time.time()\n"
    "rs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
    "print(int((time.time() - t) * 1000))\n"
    "print(sum(r['value'] for r in rs))"
)


def probe_P9():
    env = make_env()
    before = CALLS["n"]
    r = run_cell(env, P9_SERIAL)
    calls = CALLS["n"] - before
    raw = header("P9", P9_SERIAL) + f"stdout: {r.get('stdout')!r}\nhost calls: {calls}\nstderr: {r.get('stderr')!r}\n"
    if r["ok"]:
        lines = r["stdout"].split()
        ms = int(lines[0])
        verdict = "parallel" if ms < 500 else "serial"
        summary = {"probe": "P9", "outcome": "works", "detail": f"{verdict}: {ms} ms for 5 lookups, {calls} host calls, sum {lines[1]}"}
    else:
        summary = {"probe": "P9", "outcome": "error", "detail": f"{r['error_type']}: {r['error']}"}
    return raw, summary


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
    env = make_env()
    before = CALLS["n"]
    r = run_cell(env, P9B_THREADS)
    calls = CALLS["n"] - before
    raw = header("P9b", P9B_THREADS) + f"stdout: {r.get('stdout')!r}\nhost calls: {calls}\nstderr: {r.get('stderr')!r}\n"
    if r["ok"]:
        lines = r["stdout"].split()
        ms = int(lines[0])
        verdict = "parallel" if ms < 500 else "serial"
        summary = {"probe": "P9b", "outcome": "works", "detail": f"extra: {verdict} via concurrent.futures: {ms} ms, {calls} host calls, sum {lines[1]}"}
    else:
        summary = {"probe": "P9b", "outcome": "error", "detail": f"{r['error_type']}: {r['error']}"}
    return raw, summary


def probe_P10():
    code = 'raise ValueError("probe-boom")'
    env = make_env()
    r = run_cell(env, code)
    err = r.get("stderr", "")
    has_msg = "probe-boom" in err
    has_traceback = "Traceback" in err
    import re

    has_line = bool(re.search(r"line \d+", err))
    raw = header("P10", code) + f"ok: {r['ok']}\nstdout: {r.get('stdout')!r}\nstderr: {err!r}\nfinal_answer: {r.get('final_answer')!r}\n"
    summary = {
        "probe": "P10",
        "outcome": "works" if (r["ok"] and has_msg) else "error",
        "detail": (
            f"raised inside execute_code is caught: stderr = {err!r}; "
            f"message survives: {has_msg}; traceback: {has_traceback}; line number: {has_line}"
        ),
    }
    return raw, summary


def probe_P11():
    import statistics

    code = "print(2)"
    env = make_env()
    same_exec, same_wall = [], []
    for _ in range(20):
        r = run_cell(env, code)
        same_exec.append(r["result"].execution_time * 1000)
        same_wall.append(r["ms"])
    fresh_exec, fresh_wall, setup = [], [], []
    for _ in range(20):
        t0 = time.perf_counter()
        e2 = make_env()
        setup.append((time.perf_counter() - t0) * 1000)
        r = run_cell(e2, code)
        fresh_exec.append(r["result"].execution_time * 1000)
        fresh_wall.append(r["ms"])
        e2.cleanup()

    def stats(xs):
        xs = sorted(xs)
        p90 = xs[min(len(xs) - 1, int(round(0.9 * (len(xs) - 1))))]
        return {"median_ms": round(statistics.median(xs), 2), "p90_ms": round(p90, 2), "n": len(xs)}

    summary = {
        "probe": "P11",
        "outcome": "works",
        "detail": (
            f"same env, execute_code time: {stats(same_exec)}; wall: {stats(same_wall)}. "
            f"fresh env per run, execute_code time: {stats(fresh_exec)}; wall: {stats(fresh_wall)}. "
            f"one-time setup (LocalREPL construct): median {round(statistics.median(setup), 2)} ms"
        ),
        "same_env_exec": stats(same_exec),
        "fresh_env_exec": stats(fresh_exec),
        "setup_ms_median": round(statistics.median(setup), 2),
    }
    raw = header("P11", code) + f"same env exec ms: {[round(x, 3) for x in same_exec]}\nfresh env exec ms: {[round(x, 3) for x in fresh_exec]}\nsetup ms: {[round(x, 2) for x in setup]}\n"
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
        env = make_env()
        r = run_cell(env, code)
        raw += f"\n# {name}\nok={r['ok']} stdout={r.get('stdout')!r} stderr={r.get('stderr')!r} error={r.get('error')}\n"
        if r["ok"] and "PWNED" in code and "0" in r.get("stdout", "").split():
            escaped = True
            lines.append(f"{name}: escaped; os.system exit status printed as {r['stdout'].strip().splitlines()[-1]!r}")
        elif r["ok"]:
            lines.append(f"{name}: ran; stdout {r['stdout'].strip()[:80]!r}")
        else:
            lines.append(f"{name}: {r['error_type']}: {r['error']}")
    summary = {"probe": "P12", "outcome": "escaped" if escaped else "blocked", "detail": " | ".join(lines)}
    return raw, summary


def probe_CTX():
    """Extra beyond SPEC: how the corpus is exposed to the REPL, and where it lives on disk."""
    corpus = "".join(f"line {i:05d} alpha beta\n" for i in range(3000))  # about 60 KB, deliberately over 20 KB
    env = make_env(context_payload=corpus)
    corpus_file = Path(env.temp_dir) / "context_0.txt"
    r = run_cell(
        env,
        "print(type(context).__name__, len(context), context.count(chr(10)))\n"
        "print(type(context_0).__name__, context is context_0)\n"
        "print(SHOW_VARS())",
    )
    on_disk = corpus_file.exists() and corpus_file.read_text() == corpus
    raw = header("CTX", "print(type(context), len(context)) ...") + (
        f"context stdout: {r.get('stdout')!r}\nstderr: {r.get('stderr')!r}\n"
        f"corpus written to {corpus_file} (plain text, exists={corpus_file.exists()}, matches={on_disk})\n"
        f"temp_dir: {env.temp_dir}\n"
    )
    env.cleanup()
    summary = {
        "probe": "CTX",
        "outcome": "works",
        "detail": f"context is a str variable of {len(corpus)} chars; context_0 aliases it; corpus file on disk in the temp dir: {on_disk}",
        "stdout": r.get("stdout", ""),
        "corpus_file": str(corpus_file),
    }
    return raw, summary


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
    "CTX": probe_CTX,
}


def main(argv):
    for pid in argv:
        raw, summary = PROBES[pid]()
        write(pid, raw, summary)
        print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
