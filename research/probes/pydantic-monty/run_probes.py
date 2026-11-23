#!/usr/bin/env python3
"""SPEC probes P1-P12 for Pydantic Monty (pydantic-monty 1.6.0 on monty v1.6.0 @ 3f89dcb).

Run with the impl venv interpreter:
    ../../impls/pydantic-monty/.venv/bin/python run_probes.py            # all probes
    ../../impls/pydantic-monty/.venv/bin/python run_probes.py P1 P9      # some probes

Each probe runs in its own child process (the same file with --child <id>) so that
P6 and P7 can be stopped by the parent. The parent kills the child's whole process
group at 120 s wall time, and for P7 also at 4 GB summed RSS of the process tree
(the child plus the monty worker subprocesses it spawns).
"""

import asyncio
import json
import os
import signal
import statistics
import subprocess
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
VENV_PY = os.path.normpath(os.path.join(HERE, "..", "..", "impls", "pydantic-monty", ".venv", "bin", "python"))
WALL_LIMIT_S = 120
RSS_CAP_KB = 4 * 1024 * 1024  # 4 GB
ALL = [f"P{i}" for i in range(1, 13)]

LOOKUP_CALLS = {"n": 0}


def lookup(id):
    """Host tool from SPEC: waits 200 ms, returns {id, value: id * 2}."""
    LOOKUP_CALLS["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


async def alookup(id):
    LOOKUP_CALLS["n"] += 1
    await asyncio.sleep(0.2)
    return {"id": id, "value": id * 2}


def describe_exc(e):
    parts = {"type": type(e).__name__, "str": str(e)}
    try:
        parts["display"] = e.display()
    except Exception as d:  # noqa: BLE001 - record whatever the API gives
        parts["display"] = f"<display() raised {type(d).__name__}: {d}>"
    try:
        tb = e.traceback() if callable(e.traceback) else e.traceback
        parts["traceback"] = str(tb)[:1500]
    except Exception as d:  # noqa: BLE001
        parts["traceback"] = f"<traceback attr raised {type(d).__name__}: {d}>"
    return parts


def run_sync(code, *, lookup_fn=True, session=None, printed=None):
    """Run one snippet in a sync session; returns (value, exc_info or None)."""
    from pydantic_monty import Monty

    collected = printed if printed is not None else []

    def cb(stream, text):
        collected.append(text)

    kwargs = {"print_callback": cb}
    if lookup_fn:
        kwargs["external_lookup"] = {"lookup": lookup}
    if session is None:
        with Monty() as pool:
            with pool.checkout() as s:
                try:
                    return s.feed_run(code, **kwargs), None
                except Exception as e:  # noqa: BLE001
                    return None, describe_exc(e)
    try:
        return session.feed_run(code, **kwargs), None
    except Exception as e:  # noqa: BLE001
        return None, describe_exc(e)


def write_txt(pid, lines):
    with open(os.path.join(OUT, f"{pid}.txt"), "w") as f:
        f.write("\n".join(str(x) for x in lines) + "\n")


def probe_p1():
    printed = []
    LOOKUP_CALLS["n"] = 0
    code = "r = lookup(id=21)\nprint(r['value'])"
    t = time.perf_counter()
    val, exc = run_sync(code, printed=printed)
    ms = (time.perf_counter() - t) * 1000
    got = "".join(printed).strip()
    outcome = "works" if exc is None and got == "42" else "error"
    detail = f"printed {got!r}, return {val!r}, {LOOKUP_CALLS['n']} host call(s), feed+spawn {ms:.0f} ms"
    write_txt("P1", ["CODE:", code, "PRINTED:", got, "RETURN:", repr(val), "EXC:", exc, f"HOST_CALLS: {LOOKUP_CALLS['n']}"])
    return outcome, detail


def probe_p2():
    printed = []
    code = 'print("A" * 200000)\n"RETURNED"'
    val, exc = run_sync(code, lookup_fn=False, printed=printed)
    total = sum(len(x) for x in printed)
    a_count = "".join(printed).count("A")
    trunc = any("trunc" in x.lower() for x in printed)
    head = "".join(printed)[:80]
    tail = "".join(printed)[-80:]
    detail = (
        f"return value came back as {val!r}; print() arrived only via print_callback: "
        f"{total} chars, {a_count} of them 'A', truncation marker: {trunc}. "
        f"Return value and print output are separate channels."
    )
    outcome = "works" if exc is None and val == "RETURNED" else "error"
    write_txt(
        "P2",
        ["CODE:", code, "RETURN:", repr(val), "EXC:", exc,
         f"PRINT_CHUNKS: {len(printed)}", f"PRINT_CHARS: {total}", f"PRINT_A_COUNT: {a_count}",
         f"TRUNCATION_MARKER: {trunc}", f"HEAD80: {head!r}", f"TAIL80: {tail!r}"],
    )
    return outcome, detail


def probe_p3():
    results = []
    for label, code in [
        ("urllib", 'import urllib.request\nurllib.request.urlopen("https://example.com")'),
        ("socket", "import socket\nsocket.create_connection(('example.com', 443))"),
    ]:
        val, exc = run_sync(code, lookup_fn=False)
        results.append((label, exc["type"] + ": " + exc["str"] if exc else f"returned {val!r}"))
    first = results[0][1]
    outcome = "not-defined" if "ModuleNotFoundError" in first else ("works" if not first.startswith("MontyRuntimeError") else "blocked")
    detail = "; ".join(f"{k}: {v}" for k, v in results)
    write_txt("P3", ["CODE (urllib):", results[0][0], "RESULT:", results[0][1], "CODE (socket):", results[1][0], "RESULT:", results[1][1]])
    return outcome, detail


def probe_p4():
    results = []
    for label, code in [
        ("open", 'open("/etc/hosts").read()'),
        ("pathlib", "import pathlib\npathlib.Path('/etc/hosts').read_text()"),
    ]:
        val, exc = run_sync(code, lookup_fn=False)
        results.append((label, exc["str"] if exc else f"returned {str(val)[:80]!r}"))
    outcome = "blocked" if all(not r.startswith("returned") for _, r in results) else "works"
    detail = "; ".join(f"{k}: {v}" for k, v in results)
    write_txt("P4", [f"{k}: {v}" for k, v in results])
    return outcome, detail


def probe_p5():
    os.environ["PROBE_SECRET"] = "s3cr3t"  # host process env, set before the sandbox starts
    results = []
    for label, code in [
        ("os.environ.get", 'import os\nos.environ.get("PROBE_SECRET")'),
        ("os.getenv", 'import os\nos.getenv("PROBE_SECRET")'),
    ]:
        val, exc = run_sync(code, lookup_fn=False)
        results.append((label, exc["str"] if exc else f"returned {val!r}"))
    outcome = "blocked" if all(not r.startswith("returned") for _, r in results) else "works"
    detail = "; ".join(f"{k}: {v}" for k, v in results) + " (host env PROBE_SECRET=s3cr3t was set)"
    write_txt("P5", [f"{k}: {v}" for k, v in results])
    return outcome, detail


def probe_p6():
    # No limit is configured by the probe. Expected to hang; the parent stops it at 120 s.
    val, exc = run_sync("while True:\n    pass", lookup_fn=False)
    return ("limited" if exc else "works"), f"returned {val!r} / exc {exc}"


def probe_p7():
    # No limit is configured by the probe. Expected to grow until the parent's 4 GB RSS cap or 120 s.
    val, exc = run_sync('a = []\nwhile True:\n    a.append("x" * 10**6)', lookup_fn=False)
    if exc:
        # A worker SIGKILL is not a Monty limit; Monty itself reports limits as MontyRuntimeError.
        outcome = "error" if exc["type"] == "MontyCrashedError" else "limited"
        return outcome, f"{exc['type']}: {exc['str']}"
    return "works", f"returned {val!r}"


def probe_p8():
    from pydantic_monty import Monty

    with Monty() as pool:
        with pool.checkout() as s:
            s.feed_run("kept = 7", print_callback=lambda *_: None)
            printed_same = []
            s.feed_run("print(kept)", print_callback=lambda st, t: printed_same.append(t))
        with pool.checkout() as s2:
            printed_new = []
            try:
                s2.feed_run("print(kept)", print_callback=lambda st, t: printed_new.append(t))
                new_result = "".join(printed_new).strip()
            except Exception as e:  # noqa: BLE001
                new_result = describe_exc(e)["str"]
    same = "".join(printed_same).strip()
    outcome = "persists" if same == "7" else "fresh"
    detail = f"same session: kept -> {same!r}; new checkout: {new_result!r}"
    write_txt("P8", ["EXEC1: kept = 7", f"EXEC2 same session prints: {same!r}", f"EXEC3 new checkout prints/raises: {new_result!r}"])
    return outcome, detail


def probe_p9():
    async def main():
        from pydantic_monty import AsyncMonty

        LOOKUP_CALLS["n"] = 0
        code = (
            "import asyncio, time\n"
            "t = time.time()\n"
            "r = await asyncio.gather(*[lookup(id=i) for i in [1, 2, 3, 4, 5]])\n"
            "print(round((time.time() - t) * 1000))\n"
            "[x['value'] for x in r]"
        )
        printed = []
        async with AsyncMonty() as pool:
            async with pool.checkout() as s:
                t = time.perf_counter()
                try:
                    val = await s.feed_run(code, external_lookup={"lookup": alookup},
                                           print_callback=lambda st, tx: printed.append(tx))
                    exc = None
                except Exception as e:  # noqa: BLE001
                    val, exc = None, describe_exc(e)
                host_ms = (time.perf_counter() - t) * 1000
        return val, exc, host_ms, "".join(printed).strip()

    val, exc, host_ms, sandbox_ms = asyncio.run(main())
    if exc:
        outcome = "error"
        detail = f"raised {exc['str']}"
    else:
        parallel = int(sandbox_ms) < 600
        outcome = "works"
        detail = (
            f"sandbox elapsed {sandbox_ms} ms (about 200 means parallel, about 1000 serial), "
            f"{LOOKUP_CALLS['n']} host call(s), return {val!r}, host wall {host_ms:.0f} ms, parallel={parallel}"
        )
    write_txt("P9", ["CODE:", code_p9_text(), "SANDBOX_ELAPSED_MS:", sandbox_ms, "RETURN:", repr(val),
                     "EXC:", exc, f"HOST_CALLS: {LOOKUP_CALLS['n']}", f"HOST_WALL_MS: {host_ms:.0f}"])
    return outcome, detail


def code_p9_text():
    return ("import asyncio, time\nt = time.time()\n"
            "r = await asyncio.gather(*[lookup(id=i) for i in [1, 2, 3, 4, 5]])\n"
            "print(round((time.time() - t) * 1000))\n[x['value'] for x in r]")


def probe_p10():
    val, exc = run_sync('raise ValueError("probe-boom")', lookup_fn=False)
    outcome = "works" if exc else "error"
    detail = f"caller got {exc['type']} with str {exc['str']!r}; display() and traceback in out/P10.txt"
    write_txt("P10", ["CODE: raise ValueError(\"probe-boom\")", f"TYPE: {exc['type']}", f"STR: {exc['str']!r}",
                      "DISPLAY:", exc["display"], "TRACEBACK_ATTR:", exc["traceback"]])
    return outcome, detail


def probe_p11():
    from pydantic_monty import Monty

    setup_t = time.perf_counter()
    pool = Monty()
    pool.__enter__()
    setup_ms = (time.perf_counter() - setup_t) * 1000
    fresh = []
    try:
        for _ in range(20):
            t = time.perf_counter()
            with pool.checkout() as s:
                assert s.feed_run("1 + 1", print_callback=lambda st, tx: None) == 2
            fresh.append((time.perf_counter() - t) * 1000)
        warm = []
        with pool.checkout() as s:
            for _ in range(20):
                t = time.perf_counter()
                assert s.feed_run("1 + 1", print_callback=lambda st, tx: None) == 2
                warm.append((time.perf_counter() - t) * 1000)
    finally:
        pool.__exit__(None, None, None)

    def stats(xs):
        xs = sorted(xs)
        p90 = xs[min(len(xs) - 1, int(round(0.9 * (len(xs) - 1))))]
        return statistics.median(xs), p90

    med, p90 = stats(fresh)
    wmed, wp90 = stats(warm)
    outcome = "works"
    detail = (f"fresh checkout+feed: median {med:.2f} ms, p90 {p90:.2f} ms (n=20); "
              f"one feed inside one checkout: median {wmed:.3f} ms, p90 {wp90:.3f} ms (n=20); "
              f"one-time pool setup (Monty() enter, spawns worker): {setup_ms:.1f} ms")
    write_txt("P11", ["FRESH_CHECKOUT_MS:", ", ".join(f"{x:.3f}" for x in fresh),
                      "WARM_FEED_MS:", ", ".join(f"{x:.4f}" for x in warm),
                      f"SETUP_MS: {setup_ms:.2f}", f"FRESH median {med:.3f} p90 {p90:.3f}",
                      f"WARM median {wmed:.4f} p90 {wp90:.4f}"])
    return outcome, detail


def probe_p12():
    attempts = []
    for label, code in [
        ("subclasses", "print(().__class__.__base__.__subclasses__())"),
        ("import os system", '__import__("os").system("echo PWNED")'),
        ("extra: type mro", "print(type(()).__mro__)"),
        ("extra: function globals", "print((lambda: 0).__globals__)"),
    ]:
        printed = []
        val, exc = run_sync(code, lookup_fn=False, printed=printed)
        if exc:
            attempts.append((label, f"{exc['type']}: {exc['str']}"))
        else:
            attempts.append((label, f"returned {val!r}; printed {''.join(printed)[:200]!r}"))
    text = " | ".join(f"{k}: {v}" for k, v in attempts)
    # Escaped means the host object or a host call was reached: a subclass list that names
    # Popen or _wrap_close, or os.system returning without an exception.
    escaped = any("Popen" in v or "_wrap_close" in v for _, v in attempts) or \
        any(k == "import os system" and v.startswith("returned") for k, v in attempts)
    outcome = "escaped" if escaped else "blocked"
    write_txt("P12", [f"{k}: {v}" for k, v in attempts])
    return outcome, text


PROBES = {
    "P1": probe_p1, "P2": probe_p2, "P3": probe_p3, "P4": probe_p4, "P5": probe_p5,
    "P6": probe_p6, "P7": probe_p7, "P8": probe_p8, "P9": probe_p9, "P10": probe_p10,
    "P11": probe_p11, "P12": probe_p12,
}


def child_main(pid):
    os.environ.setdefault("PROBE_SECRET", "s3cr3t")
    try:
        outcome, detail = PROBES[pid]()
        status = {"id": pid, "outcome": outcome, "detail": detail, "error": None}
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        status = {"id": pid, "outcome": "error", "detail": "", "error": traceback.format_exc()}
    with open(os.path.join(OUT, f"{pid}.json"), "w") as f:
        json.dump(status, f)


def tree_rss_kb(root_pid):
    try:
        ps = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return 0
    children = {}
    rss = {}
    for line in ps.splitlines():
        pid, ppid, r = line.split()
        children.setdefault(int(ppid), []).append(int(pid))
        rss[int(pid)] = int(r)
    total, stack = 0, [root_pid]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(children.get(p, []))
    return total


def parent_run(pid):
    json_path = os.path.join(OUT, f"{pid}.json")
    if os.path.exists(json_path):
        os.remove(json_path)
    log = open(os.path.join(OUT, f"{pid}.stdout.log"), "w")
    proc = subprocess.Popen([VENV_PY, os.path.abspath(__file__), "--child", pid],
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    start = time.monotonic()
    peak_kb = 0
    killed_reason = None
    last_sample = 0.0
    while proc.poll() is None:
        elapsed = time.monotonic() - start
        if elapsed > WALL_LIMIT_S:
            killed_reason = "wall"
            break
        if pid == "P7" and elapsed - last_sample >= 0.25:
            last_sample = elapsed
            kb = tree_rss_kb(proc.pid)
            peak_kb = max(peak_kb, kb)
            if kb > RSS_CAP_KB:
                killed_reason = "rss"
                break
        time.sleep(0.05)
    elapsed = time.monotonic() - start
    if killed_reason:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    log.close()
    if killed_reason == "wall":
        result = {"id": pid, "outcome": "no-limit-within-120s", "detail": f"no limit fired; stopped by harness at {elapsed:.0f} s wall"}
    elif killed_reason == "rss":
        result = {"id": pid, "outcome": "no-limit-within-120s",
                  "detail": f"no Monty limit fired; harness killed the process tree on the first sample above 4 GiB, at {elapsed:.1f} s (sampled peak {peak_kb/1024/1024:.2f} GiB)"}
    else:
        with open(json_path) as f:
            result = json.load(f)
        if pid == "P7":
            result["detail"] += f" | run ended after {elapsed:.1f} s, sampled peak RSS {peak_kb/1024/1024:.2f} GB"
    if pid == "P6":
        write_txt("P6", [f"CODE: while True: pass", f"OUTCOME: {result['outcome']}", result["detail"]])
    if pid == "P7" and killed_reason:
        write_txt("P7", ["CODE: a=[]; while True: a.append('x'*10**6)", f"OUTCOME: {result['outcome']}", result["detail"]])
    return result


def main(argv):
    if len(argv) >= 3 and argv[1] == "--child":
        child_main(argv[2])
        return 0
    os.makedirs(OUT, exist_ok=True)
    wanted = argv[1:] or ALL
    summary = {}
    for pid in wanted:
        t = time.monotonic()
        res = parent_run(pid)
        summary[pid] = res
        print(f"{pid}\t{res['outcome']}\t{res['detail']}\t(harness {time.monotonic() - t:.1f} s)", flush=True)
    with open(os.path.join(OUT, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
