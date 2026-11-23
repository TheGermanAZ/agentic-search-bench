"""SPEC probes for alexzhang13/rlm DockerREPL (commit e11f1a8, rlm 0.1.3), the `docker` environment.

Runs code through DockerREPL.execute_code(), the call RLM makes per cell. No LLM: lm_handler_address is None.
Harness-only patches, none of which change what the sandbox can do:
  - the container gets `--name rlm-docker-<probe>` (DockerREPL names nothing), so the parent can stop it;
  - the host proxy binds port 41920 instead of an OS-chosen port (shared-machine port range).
DockerREPL skips host callables in custom_tools (docker_repl.py:248-253), so `lookup` is passed both as a
host function (P1, to show what happens) and as a code string, which runs inside the container.

Usage:
    PY=../../impls/rlm-docker/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12
    ../mem-lock.sh $PY harness.py P7
The parent stops a probe at 120 s or 4 GiB container memory (cgroup memory.current), then removes the container.
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
IMPL = HERE.parent.parent / "impls" / "rlm-docker"
os.environ["RLM_DOCKER_WORKSPACE_DIR"] = str(IMPL / "workspace")
PORT = 41920
CALLS = {"n": 0}

LOOKUP_SRC = (
    "def lookup(id):\n"
    "    import time\n"
    "    time.sleep(0.2)\n"
    "    return {'id': id, 'value': id * 2}\n"
)


def host_lookup(id):
    CALLS["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


def patch(name):
    import rlm.environments.docker_repl as d

    real_run = subprocess.run

    def run(args, *a, **kw):
        if list(args[:3]) == ["docker", "run", "-d"]:
            args = list(args[:3]) + ["--name", name] + list(args[3:])
        return real_run(args, *a, **kw)

    class Server(d.ThreadingHTTPServer):
        def __init__(self, addr, handler):
            super().__init__((addr[0], PORT + int(re.sub(r"\D", "", name)[:2] or 0)), handler)

    d.subprocess = type("S", (), {"run": staticmethod(run), "PIPE": subprocess.PIPE})
    d.ThreadingHTTPServer = Server
    return d


def make_env(name, tool="code"):
    d = patch(name)
    tools = {"lookup": LOOKUP_SRC if tool == "code" else host_lookup}
    return d.DockerREPL(custom_tools=tools)


def cell(env, code):
    t0 = time.perf_counter()
    r = env.execute_code(code)
    return {"stdout": r.stdout, "stderr": r.stderr, "ms": round((time.perf_counter() - t0) * 1000, 1)}


CODE = {
    "P1": "r = lookup(id=21)\nprint(r['value'])",
    "P2": 'print("A" * 200000)\n"RETURNED"',
    "P3": 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)',
    "P4": 'print(open("/etc/hosts").read())',
    "P5": 'import os\nprint(os.environ.get("PROBE_SECRET"))',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    "P9": ("import time, concurrent.futures\nt = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
           "print('loop', int((time.time() - t) * 1000))\nt = time.time()\n"
           "with concurrent.futures.ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\n"
           "print('threads', int((time.time() - t) * 1000), sum(r['value'] for r in rs))"),
    "P10": 'raise ValueError("probe-boom")',
    "P12": ("subs = ().__class__.__base__.__subclasses__()\nwc = [c for c in subs if c.__name__ == '_wrap_close']\n"
            "print(len(subs), len(wc))\nprint(__import__('os').system('echo PWNED; hostname'))\n"
            "print(wc[0].__init__.__globals__['system']('echo PWNED2'))\n"
            "import os\nprint('docker.sock', os.path.exists('/var/run/docker.sock'), 'Users', os.path.exists('/Users'))\n"
            "print('workspace', os.listdir('/workspace'))\n"
            "open('/workspace/written_by_sandbox.txt', 'w').write('x')\n"
            "import urllib.request\n"
            "print('proxy', urllib.request.urlopen(urllib.request.Request('http://host.docker.internal:41932/llm_query', "
            "data=b'{}', headers={'Content-Type': 'application/json'})).read()[:120])"),
}


def child(pid):
    os.environ["PROBE_SECRET"] = "s3cr3t"
    name = f"rlm-docker-{pid.lower()}"
    raw, res = {}, {}
    t0 = time.perf_counter()
    if pid == "P1":
        env = make_env(name, tool="host")
        raw["host_callable"] = cell(env, CODE["P1"])
        raw["host_calls"] = CALLS["n"]
        env.cleanup()
        env = make_env(name + "b")
        raw["code_string"] = cell(env, CODE["P1"])
        env.cleanup()
    elif pid == "P8":
        env = make_env(name)
        raw["exec1"] = cell(env, "kept = 7")
        raw["exec2"] = cell(env, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
        env.cleanup()
    elif pid == "P11":
        t = time.perf_counter()
        env = make_env(name)
        setup_ms = (time.perf_counter() - t) * 1000
        same = [cell(env, "print(2)")["ms"] for _ in range(20)]
        env.cleanup()
        fresh = []
        for i in range(5):
            t = time.perf_counter()
            e2 = make_env(f"{name}-{i}")
            cell(e2, "print(2)")
            fresh.append((time.perf_counter() - t) * 1000)
            e2.cleanup()
        xs = sorted(same)
        raw = {"setup_ms": round(setup_ms), "same_env_ms": same, "fresh_env_incl_setup_ms": [round(x) for x in fresh],
               "median": statistics.median(xs), "p90": xs[int(round(0.9 * 19))]}
    else:
        env = make_env(name)
        raw["result"] = cell(env, CODE[pid])
        if pid == "P12":
            raw["host_side_file_exists"] = any((IMPL / "workspace").rglob("written_by_sandbox.txt"))
        env.cleanup()
    raw["wall_s"] = round(time.perf_counter() - t0, 2)
    (OUT / f"{pid}.raw.json").write_text(json.dumps(raw, indent=2))
    print(json.dumps(raw)[:1500], flush=True)


def container_mem(name):
    r = subprocess.run(["docker", "exec", name, "cat", "/sys/fs/cgroup/memory.current"], capture_output=True, text=True)
    return int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else 0


def parent(pid):
    name = f"rlm-docker-{pid.lower()}"
    (OUT / f"{pid}.raw.json").unlink(missing_ok=True)
    proc = subprocess.Popen([sys.executable, __file__, "--child", pid], start_new_session=True,
                            env={**os.environ, "PROBE_SECRET": "s3cr3t"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start, peak, reason = time.monotonic(), 0, None
    while proc.poll() is None:
        el = time.monotonic() - start
        if pid == "P7":
            m = container_mem(name)
            peak = max(peak, m)
            if m > 4 * 1024**3:
                reason = "4 GiB container memory"
        if el > 120:
            reason = "120 s wall"
        if reason:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):  # child already exited after the container went away
                pass
            break
        time.sleep(0.1 if pid == "P7" else 0.5)
    out = proc.communicate()[0]
    el = time.monotonic() - start
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    res = {"probe": pid, "harness_wall_s": round(el, 1), "peak_container_mem_mib": round(peak / 1024**2)}
    if reason:
        res["harness_stop"] = reason
    rawp = OUT / f"{pid}.raw.json"
    res["raw"] = json.loads(rawp.read_text()) if rawp.exists() else None
    res["child_tail"] = out[-1500:]
    (OUT / f"{pid}.txt").write_text(f"code:\n{CODE.get(pid)}\n\n" + json.dumps(res, indent=2))
    print(pid, json.dumps({k: v for k, v in res.items() if k != "child_tail"})[:1200], flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "--child":
        child(sys.argv[2])
    else:
        for p in sys.argv[1:]:
            parent(p)
