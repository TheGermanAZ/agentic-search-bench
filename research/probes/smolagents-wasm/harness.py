"""SPEC + RUBRIC probes for smolagents WasmExecutor (Pyodide in Deno), smolagents 1.25.0 from PyPI.

WasmExecutor was CodeAgent(executor_type="wasm") from v1.20.0 until v1.26.0 removed it (commit fd87137,
"Remove remote WasmExecutor (#2321)"). 1.25.0 is the last release that ships it. No LLM.
Default WasmExecutor fails to start on macOS: tempfile gives /var/folders/..., Deno canonicalizes reads to
/private/var/folders/..., and the --allow-read=<deno_cache_dir> grant no longer matches (out/startup-default-tmpdir.txt).
The harness sets TMPDIR to a canonical path outside the repo (WASM_TMPDIR, default /private/tmp/smolagents-wasm-tmp)
so the default permissions work. Inside the repo, Deno would pick up the repo's package.json and write deno.lock there.
Harness-only change: WasmExecutor.DEFAULT_SERVER_PORT is set to 41985 + probe number (shared-machine port range).
Hardened: timeout=5 (the only stricter option besides deno_permissions, whose default is already the narrowest
that still loads Pyodide).

Usage:
    PY=../../impls/smolagents-wasm/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh $PY harness.py P7
    $PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../mem-lock.sh $PY harness.py --hardened P7
The parent kills the process group at 120 s or 4 GiB summed tree RSS (python + deno).
"""

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
PORT = 41980

from smolagents import Tool  # noqa: E402


class Lookup(Tool):
    name = "lookup"
    description = "Waits 200 ms, then returns {id, value: id * 2}."
    inputs = {"id": {"type": "integer", "description": "The id to look up."}}
    output_type = "object"

    def forward(self, id: int):
        import time

        time.sleep(0.2)
        return {"id": id, "value": id * 2}


def make_executor(pid, hardened):
    from smolagents.monitoring import AgentLogger, LogLevel
    from smolagents.remote_executors import WasmExecutor

    WasmExecutor.DEFAULT_SERVER_PORT = PORT + int(re.sub(r"\D", "", pid)) + (0 if not hardened else 0)
    kw = {"timeout": 5} if hardened else {}
    ex = WasmExecutor(additional_imports=[], logger=AgentLogger(level=LogLevel.ERROR), **kw)
    ex.send_tools({"lookup": Lookup()})
    return ex


def attempt(ex, code):
    t0 = time.perf_counter()
    try:
        r = ex(code)
        return {"ok": True, "output": repr(r.output), "logs": r.logs, "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:3000], "ms": round((time.perf_counter() - t0) * 1000, 1)}


CODE = {
    "P1": "r = lookup(id=21)\nprint(r['value'])",
    "P2": 'print("A" * 200000)\n"RETURNED"',
    "P3": ('import urllib.request\ntry:\n    print(urllib.request.urlopen("https://example.com").status)\n'
           'except Exception as e:\n    print("urllib:", type(e).__name__, e)\n'
           'from pyodide.http import pyfetch\nr = await pyfetch("https://example.com")\nprint("pyfetch", r.status)'),
    "P4": 'print(open("/etc/hosts").read())',
    "P5": 'import os\nprint(os.environ.get("PROBE_SECRET"))',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    "P9": ("import time, asyncio\nt = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
           "print('loop', int((time.time() - t) * 1000), sum(r['value'] for r in rs))"),
    "P10": 'raise ValueError("probe-boom")',
    "P12": [
        "subs = ().__class__.__base__.__subclasses__()\nwc = [c for c in subs if c.__name__ == '_wrap_close']\nprint(len(subs), len(wc))",
        "print(__import__('os').system('echo PWNED'))",
        "import subprocess\nprint(subprocess.run(['id'], capture_output=True, text=True).stdout)",
        "import js\nprint(js.Deno.readTextFileSync('/etc/hosts')[:60])",
        "import js\nprint(js.Deno.env.get('PROBE_SECRET'))",
        "import js\np = js.Deno.Command.new('echo', js.JSON.parse('{\"args\": [\"PWNED\"]}'))\nprint(p.outputSync())",
    ],
}


def child(pid, hardened):
    os.environ["PROBE_SECRET"] = "s3cr3t"
    raw = {}
    t0 = time.perf_counter()
    ex = make_executor(pid, hardened)
    raw["setup_ms"] = round((time.perf_counter() - t0) * 1000)
    if pid == "P8":
        raw["exec1"] = attempt(ex, "kept = 7")
        raw["exec2"] = attempt(ex, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
    elif pid == "P11":
        same = [attempt(ex, "print(2)")["ms"] for _ in range(20)]
        xs = sorted(same)
        raw.update(same_executor_ms=same, median=statistics.median(xs), p90=xs[int(round(0.9 * 19))])
    elif pid == "P12":
        # Each attempt gets a fresh executor: one crash of the Deno server must not hide the later attempts.
        raw["attempts"] = []
        for c in CODE["P12"]:
            r = {"code": c, **attempt(ex, c), "server_alive_after": ex.server_process.poll() is None}
            if not r["server_alive_after"]:
                r["deno_stderr_tail"] = ex.server_process.stderr.read()[-1500:]
                r["deno_exit_code"] = ex.server_process.returncode
            raw["attempts"].append(r)
            ex.cleanup()
            ex = make_executor(pid, hardened)
    else:
        raw["result"] = attempt(ex, CODE[pid])
        if pid in ("P6", "P7"):
            raw["after"] = attempt(ex, "print(1 + 1)")
    ex.cleanup()
    raw["wall_s"] = round(time.perf_counter() - t0, 2)
    (OUT / f"{'hardened-' if hardened else ''}{pid}.raw.json").write_text(json.dumps(raw, indent=2))


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
    rawp = OUT / f"{prefix}{pid}.raw.json"
    rawp.unlink(missing_ok=True)
    args = [sys.executable, __file__, "--child", pid] + (["--hardened"] if hardened else [])
    tmp = os.environ.get("WASM_TMPDIR", "/private/tmp/smolagents-wasm-tmp")
    os.makedirs(tmp, exist_ok=True)
    proc = subprocess.Popen(args, start_new_session=True, env={**os.environ, "PROBE_SECRET": "s3cr3t", "TMPDIR": str(tmp), "NO_COLOR": "1"},
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start, peak, reason = time.monotonic(), 0, None
    while proc.poll() is None:
        kb = tree_rss_kb(proc.pid)
        peak = max(peak, kb)
        el = time.monotonic() - start
        reason = "120 s wall" if el > 120 else ("4 GiB tree RSS" if kb > 4 * 1024 * 1024 else None)
        if reason:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            break
        time.sleep(0.1)
    out = proc.communicate()[0]
    el = time.monotonic() - start
    res = {"probe": pid, "hardened": hardened, "harness_wall_s": round(el, 1), "peak_tree_rss_mib": round(peak / 1024)}
    if reason:
        res["harness_stop"] = reason
    res["raw"] = json.loads(rawp.read_text()) if rawp.exists() else None
    res["child_tail"] = out[-2000:]
    cfg = "WasmExecutor(additional_imports=[], timeout=5)" if hardened else "WasmExecutor(additional_imports=[])"
    (OUT / f"{prefix}{pid}.txt").write_text(f"config: {cfg}\ncode:\n{json.dumps(CODE.get(pid), indent=1)}\n\n" + json.dumps(res, indent=2))
    print(prefix + pid, json.dumps({k: v for k, v in res.items() if k != "child_tail"})[:1500], flush=True)
    if not res["raw"]:
        print("  child tail:", out[-800:])


if __name__ == "__main__":
    argv = sys.argv[1:]
    hardened = "--hardened" in argv
    argv = [a for a in argv if a != "--hardened"]
    if argv[0] == "--child":
        child(argv[1], hardened)
    else:
        for p in argv:
            parent(p, hardened)
