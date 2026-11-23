"""RUBRIC hardened run for alexzhang13/rlm (commit e11f1a8), local family.

Hardened config: the `ipython` environment in subprocess kernel mode with the documented cell timeout,
    get_environment("ipython", {"kernel_mode": "subprocess", "cell_timeout": 30, "custom_tools": {"lookup": lookup}})
from docs/src/app/environments/ipython/page.tsx:46-49 and rlm/environments/__init__.py get_environment.
RLM exposes no memory or network option for local environments. The container backend is probed
separately as rlm-docker.

Usage (P7 through the shared memory lock):
    PY=../../impls/rlm/.venv-ipython/bin/python
    for p in P3 P4 P5 P6 P9 P12; do $PY hardened.py $p; done
    ../mem-lock.sh $PY hardened.py P7
The parent kills the process group at 120 s or 4 GiB summed RSS of the process tree (parent + kernel).
Writes out/hardened-<P>.txt and out/hardened-<P>.json.
"""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
CONFIG = {"kernel_mode": "subprocess", "cell_timeout": 30}
RSS_CAP_KB = 4 * 1024 * 1024
CALLS = {"n": 0}


def lookup(id):
    """Host tool: waits 200 ms, returns {id, value: id * 2}. In subprocess mode rlm ships it into the kernel with dill."""
    import time as _t

    CALLS["n"] += 1
    _t.sleep(0.2)
    return {"id": id, "value": id * 2}


def make_env():
    from rlm.environments import get_environment

    return get_environment("ipython", {**CONFIG, "custom_tools": {"lookup": lookup}})


def cell(env, code):
    t0 = time.perf_counter()
    try:
        r = env.execute_code(code)
        return {"ok": True, "stdout": r.stdout, "stderr": r.stderr, "s": round(time.perf_counter() - t0, 2)}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "s": round(time.perf_counter() - t0, 2)}


CODE = {
    "P3": 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)',
    "P4": 'print(open("/etc/hosts").read()[:60])',
    "P5": 'import os\nprint(os.environ.get("PROBE_SECRET"))',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    "P9": ("import time, concurrent.futures\nt = time.time()\n"
           "with concurrent.futures.ThreadPoolExecutor(5) as ex:\n"
           "    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\n"
           "print(int((time.time() - t) * 1000), sum(r['value'] for r in rs))\n"
           "t = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\nprint(int((time.time() - t) * 1000))\n"
           "import os\nprint('kernel pid', os.getpid(), 'parent', os.getppid())"),
    "P12": ("subs = ().__class__.__base__.__subclasses__()\n"
            "wc = [c for c in subs if c.__name__ == '_wrap_close']\n"
            "print(len(subs), len(wc))\n"
            "print(__import__('os').system('echo PWNED'))\n"
            "print(wc[0].__init__.__globals__['system']('echo PWNED2'))"),
}


def child(pid):
    env = make_env()
    t0 = time.perf_counter()
    r = cell(env, CODE[pid])
    extra = ""
    if pid in ("P6", "P7"):
        after = cell(env, "print(1 + 1)")
        extra = f"\nsame env after the probe: {after}"
    env.cleanup()
    raw = (f"config: get_environment('ipython', {CONFIG})\ncode:\n{CODE[pid]}\nresult: {r}{extra}\n"
           f"host-side lookup calls: {CALLS['n']}\nhost pid: {os.getpid()}\nwall: {time.perf_counter() - t0:.2f} s\n")
    (OUT / f"hardened-{pid}.txt").write_text(raw)
    print(json.dumps({"r": r, "host_calls": CALLS["n"], "extra": extra}), flush=True)


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


def parent(pid):
    import certifi  # this Mac's default OpenSSL CA path is missing (see run_all.sh)

    env = {**os.environ, "PROBE_SECRET": "s3cr3t", "SSL_CERT_FILE": certifi.where()}
    proc = subprocess.Popen([sys.executable, __file__, "--child", pid], env=env, start_new_session=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start, peak, reason = time.monotonic(), 0, None
    while proc.poll() is None:
        el = time.monotonic() - start
        kb = tree_rss_kb(proc.pid)
        peak = max(peak, kb)
        if el > 120:
            reason = "120 s wall"
        elif kb > RSS_CAP_KB:
            reason = "4 GiB tree RSS"
        if reason:
            os.killpg(proc.pid, signal.SIGKILL)
            break
        time.sleep(0.1)
    out = proc.communicate()[0]
    el = time.monotonic() - start
    summary = {"probe": pid, "config": CONFIG, "peak_tree_rss_mib": round(peak / 1024), "wall_s": round(el, 2)}
    if reason:
        summary.update(outcome="no-limit-within-120s", detail=f"harness killed the process group at {reason} after {el:.1f} s")
        (OUT / f"hardened-{pid}.txt").write_text(f"config: {CONFIG}\ncode:\n{CODE[pid]}\nharness kill: {reason} after {el:.1f} s, peak tree RSS {peak} KiB\n{out}")
    else:
        summary["child"] = out.strip().splitlines()[-1] if out.strip() else ""
    (OUT / f"hardened-{pid}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary)[:900], flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "--child":
        child(sys.argv[2])
    else:
        for p in sys.argv[1:]:
            parent(p)
