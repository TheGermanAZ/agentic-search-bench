#!/usr/bin/env python3
"""RUBRIC hardened run for Pydantic Monty: P3 P4 P5 P6 P7 P9 P12 with the documented limits.

Limits are the example in the project's own docs (src/docs/resource-limits.md:11-15 at v1.6.0):
    {'max_memory': 10_000_000, 'max_feed_duration_secs': 1.0, 'max_recursion_depth': 100}
passed as `pool.checkout(limits=...)`. Monty has no network or filesystem option to tighten:
the sandbox has no socket/urllib module and file access already needs a host `os` handler.

Usage (P7 must go through the shared memory lock):
    ../../impls/pydantic-monty/.venv/bin/python hardened.py P3 P4 P5 P6 P9 P12
    ../mem-lock.sh ../../impls/pydantic-monty/.venv/bin/python hardened.py P7
Writes out/hardened-<P>.txt and out/hardened-<P>.json.
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import time

import run_probes as rp

LIMITS = {"max_memory": 10_000_000, "max_feed_duration_secs": 1.0, "max_recursion_depth": 100}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")


def run_sync(code, *, lookup_fn=True, session=None, printed=None):
    from pydantic_monty import Monty

    collected = printed if printed is not None else []
    kwargs = {"print_callback": lambda st, tx: collected.append(tx)}
    if lookup_fn:
        kwargs["external_lookup"] = {"lookup": rp.lookup}
    t = time.perf_counter()
    with Monty() as pool:
        with pool.checkout(limits=LIMITS) as s:
            try:
                val = s.feed_run(code, **kwargs)
                return val, None
            except Exception as e:  # noqa: BLE001
                info = rp.describe_exc(e)
                info["elapsed_s"] = round(time.perf_counter() - t, 3)
                return None, info


def write_txt(pid, lines):
    with open(os.path.join(OUT, f"hardened-{pid}.txt"), "w") as f:
        f.write(f"LIMITS: {LIMITS}\n" + "\n".join(str(x) for x in lines) + "\n")


rp.run_sync = run_sync
rp.write_txt = write_txt


def probe_p6():
    t = time.perf_counter()
    val, exc = run_sync("while True:\n    pass", lookup_fn=False)
    wall = time.perf_counter() - t
    if exc:
        outcome = "limited" if "TimeoutError" in exc["str"] else "error"
        detail = f"{exc['type']}: {exc['str']} after {wall:.2f} s wall (pool spawn included)"
    else:
        outcome, detail = "works", f"returned {val!r}"
    write_txt("P6", ["CODE: while True: pass", f"OUTCOME: {outcome}", detail, "DISPLAY:", (exc or {}).get("display")])
    return outcome, detail


def probe_p7():
    t = time.perf_counter()
    val, exc = run_sync('a = []\nwhile True:\n    a.append("x" * 10**6)', lookup_fn=False)
    wall = time.perf_counter() - t
    if exc:
        outcome = "limited" if "MemoryError" in exc["str"] else ("error" if exc["type"] == "MontyCrashedError" else "limited")
        detail = f"{exc['type']}: {exc['str']} after {wall:.2f} s"
    else:
        outcome, detail = "works", f"returned {val!r}"
    # Host survival: the same Python process opens a new pool and runs code after the trip.
    from pydantic_monty import Monty

    with Monty() as pool:
        with pool.checkout() as s:
            after = s.feed_run("1 + 1")
    detail += f"; host process alive afterwards, new session returned {after}"
    write_txt("P7", ["CODE: a=[]; while True: a.append('x'*10**6)", f"OUTCOME: {outcome}", detail,
                     "DISPLAY:", (exc or {}).get("display")])
    return outcome, detail


def probe_p9():
    async def main():
        from pydantic_monty import AsyncMonty

        rp.LOOKUP_CALLS["n"] = 0
        printed = []
        async with AsyncMonty() as pool:
            async with pool.checkout(limits=LIMITS) as s:
                t = time.perf_counter()
                try:
                    val = await s.feed_run(rp.code_p9_text(), external_lookup={"lookup": rp.alookup},
                                           print_callback=lambda st, tx: printed.append(tx))
                    exc = None
                except Exception as e:  # noqa: BLE001
                    val, exc = None, rp.describe_exc(e)
                host_ms = (time.perf_counter() - t) * 1000
        return val, exc, host_ms, "".join(printed).strip()

    val, exc, host_ms, sandbox_ms = asyncio.run(main())
    if exc:
        outcome, detail = "error", f"raised {exc['str']}"
    else:
        outcome = "works"
        detail = (f"sandbox elapsed {sandbox_ms} ms, {rp.LOOKUP_CALLS['n']} host call(s), return {val!r}, "
                  f"host wall {host_ms:.0f} ms; suspended time does not count toward max_feed_duration_secs")
    write_txt("P9", ["CODE:", rp.code_p9_text(), "SANDBOX_ELAPSED_MS:", sandbox_ms, "RETURN:", repr(val),
                     "EXC:", exc, f"HOST_CALLS: {rp.LOOKUP_CALLS['n']}", f"HOST_WALL_MS: {host_ms:.0f}"])
    return outcome, detail


PROBES = {"P3": rp.probe_p3, "P4": rp.probe_p4, "P5": rp.probe_p5, "P6": probe_p6, "P7": probe_p7,
          "P9": probe_p9, "P12": rp.probe_p12}


def child(pid):
    os.environ["PROBE_SECRET"] = "s3cr3t"
    outcome, detail = PROBES[pid]()
    with open(os.path.join(OUT, f"hardened-{pid}.json"), "w") as f:
        json.dump({"id": pid, "outcome": outcome, "detail": detail, "limits": LIMITS}, f, indent=2)


def parent(pid):
    path = os.path.join(OUT, f"hardened-{pid}.json")
    if os.path.exists(path):
        os.remove(path)
    proc = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--child", pid],
                            start_new_session=True, env={**os.environ, "PROBE_SECRET": "s3cr3t"})
    start, peak, reason = time.monotonic(), 0, None
    while proc.poll() is None:
        el = time.monotonic() - start
        if el > 120:
            reason = "wall"
            break
        kb = rp.tree_rss_kb(proc.pid)
        peak = max(peak, kb)
        if kb > rp.RSS_CAP_KB:
            reason = "rss"
            break
        time.sleep(0.1)
    if reason:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        res = {"id": pid, "outcome": "no-limit-within-120s",
               "detail": f"harness stopped it ({reason}) at {time.monotonic() - start:.1f} s, peak {peak / 1024:.0f} MiB"}
        with open(path, "w") as f:
            json.dump(res, f, indent=2)
    else:
        with open(path) as f:
            res = json.load(f)
    res["peak_tree_rss_mib"] = round(peak / 1024)
    with open(path, "w") as f:
        json.dump(res, f, indent=2)
    print(f"{pid}\t{res['outcome']}\t{res['detail']}\tpeak {peak / 1024:.0f} MiB", flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "--child":
        child(sys.argv[2])
    else:
        for p in sys.argv[1:]:
            parent(p)
