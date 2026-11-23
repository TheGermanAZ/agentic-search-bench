"""SPEC + RUBRIC probes for smolagents DockerExecutor (smolagents 1.26.0, tag v1.26.0 = 12c1bc8).

DockerExecutor is what CodeAgent(executor_type="docker") builds (agents.py:1598-1619). It builds a Jupyter
Kernel Gateway image, runs one container, and executes each snippet over the kernel websocket. No LLM.
Public options used: port=41940 + probe number (+20 hardened; shared-machine port range), image_name="smolagents-docker-jupyter-kernel",
container_run_kwargs={"name": "smolagents-docker-<probe>"}. lookup is a smolagents Tool sent with send_tools,
which ships its source code into the kernel (remote_executors.py:94-113).

Hardened adds the container limits from the project's secure-execution tutorial
(docs/source/en/tutorials/secure_code_execution.md:366-375): mem_limit="512m", cpu_quota=50000, pids_limit=100,
security_opt=["no-new-privileges"], cap_drop=["ALL"].

Usage:
    PY=../../impls/smolagents-docker/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh $PY harness.py P7
    $PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../mem-lock.sh $PY harness.py --hardened P7
The parent stops a probe at 120 s or 4 GiB container memory and removes the container.
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
PORT = 41940
IMAGE = "smolagents-docker-jupyter-kernel"
HARDENED_KW = {"mem_limit": "512m", "cpu_quota": 50000, "pids_limit": 100,
               "security_opt": ["no-new-privileges"], "cap_drop": ["ALL"]}
EXTRA_NET = os.environ.get("HARDENED_NETWORK")  # e.g. "none": tried separately, see README

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


def make_executor(name, hardened):
    from smolagents.monitoring import AgentLogger, LogLevel
    from smolagents.remote_executors import DockerExecutor

    kw = {"name": name}
    if hardened:
        kw.update(HARDENED_KW)
        if EXTRA_NET:
            kw["network_mode"] = EXTRA_NET
    port = PORT + int(re.sub(r"\D", "", name)) + (20 if hardened else 0)  # one port per probe, 41940-41979
    ex = DockerExecutor(additional_imports=[], logger=AgentLogger(level=LogLevel.ERROR), port=port,
                        image_name=IMAGE, build_new_image=False, container_run_kwargs=kw)
    ex.send_tools({"lookup": Lookup()})
    return ex


def attempt(ex, code):
    t0 = time.perf_counter()
    try:
        r = ex(code)
        return {"ok": True, "output": repr(r.output), "logs": r.logs, "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "ms": round((time.perf_counter() - t0) * 1000, 1)}


CODE = {
    "P1": "r = lookup(id=21)\nprint(r['value'])",
    "P2": 'print("A" * 200000)\n"RETURNED"',
    "P3": 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)',
    "P4": 'print(open("/etc/hosts").read())',
    "P5": 'import os\nprint(os.environ.get("PROBE_SECRET"))',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    "P9": ("import time, asyncio, concurrent.futures\nt = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
           "print('loop', int((time.time() - t) * 1000))\nt = time.time()\n"
           "with concurrent.futures.ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\n"
           "print('threads', int((time.time() - t) * 1000), sum(r['value'] for r in rs))"),
    "P10": 'raise ValueError("probe-boom")',
    "P12": ("subs = ().__class__.__base__.__subclasses__()\nwc = [c for c in subs if c.__name__ == '_wrap_close']\n"
            "print(len(subs), len(wc))\nprint(__import__('os').system('echo PWNED; hostname'))\n"
            "print(wc[0].__init__.__globals__['system']('echo PWNED2'))\n"
            "import subprocess\nprint(subprocess.run(['id'], capture_output=True, text=True).stdout)\n"
            "import os\nprint('docker.sock', os.path.exists('/var/run/docker.sock'), 'Users', os.path.exists('/Users'))"),
}


def child(pid, hardened):
    os.environ["PROBE_SECRET"] = "s3cr3t"
    name = f"smolagents-docker-{'h-' if hardened else ''}{pid.lower()}"
    raw = {}
    t0 = time.perf_counter()
    try:
        ex = make_executor(name, hardened)
    except BaseException as e:  # noqa: BLE001
        raw["setup_error"] = f"{type(e).__name__}: {e}"[:2000]
        (OUT / f"{'hardened-' if hardened else ''}{pid}.raw.json").write_text(json.dumps(raw, indent=2))
        return
    raw["setup_ms"] = round((time.perf_counter() - t0) * 1000)
    if pid == "P8":
        raw["exec1"] = attempt(ex, "kept = 7")
        raw["exec2"] = attempt(ex, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
    elif pid == "P11":
        same = [attempt(ex, "print(2)")["ms"] for _ in range(20)]
        xs = sorted(same)
        raw.update(same_executor_ms=same, median=statistics.median(xs), p90=xs[int(round(0.9 * 19))])
    else:
        raw["result"] = attempt(ex, CODE[pid])
        if pid in ("P6", "P7"):
            raw["after"] = attempt(ex, "print(1 + 1)")
    ex.cleanup()
    raw["wall_s"] = round(time.perf_counter() - t0, 2)
    (OUT / f"{'hardened-' if hardened else ''}{pid}.raw.json").write_text(json.dumps(raw, indent=2))


def container_mem(name):
    r = subprocess.run(["docker", "exec", name, "cat", "/sys/fs/cgroup/memory.current"], capture_output=True, text=True)
    return int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else 0


def parent(pid, hardened):
    prefix = "hardened-" if hardened else ""
    name = f"smolagents-docker-{'h-' if hardened else ''}{pid.lower()}"
    rawp = OUT / f"{prefix}{pid}.raw.json"
    rawp.unlink(missing_ok=True)
    args = [sys.executable, __file__, "--child", pid] + (["--hardened"] if hardened else [])
    proc = subprocess.Popen(args, start_new_session=True, env={**os.environ, "PROBE_SECRET": "s3cr3t"},
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start, peak, reason, oom = time.monotonic(), 0, None, None
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
            insp = subprocess.run(["docker", "inspect", "-f", "{{.State.OOMKilled}} {{.RestartCount}}", name], capture_output=True, text=True)
            oom = insp.stdout.strip()
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
    res = {"probe": pid, "hardened": hardened, "harness_wall_s": round(el, 1), "peak_container_mem_mib": round(peak / 1024**2)}
    if reason:
        res["harness_stop"] = reason
        res["inspect_at_stop"] = oom
    res["raw"] = json.loads(rawp.read_text()) if rawp.exists() else None
    res["child_tail"] = out[-1500:]
    cfg = {"port": PORT, "image_name": IMAGE, "container_run_kwargs": {"name": name, **(HARDENED_KW if hardened else {})}}
    (OUT / f"{prefix}{pid}.txt").write_text(f"config: {json.dumps(cfg)}\ncode:\n{CODE.get(pid)}\n\n" + json.dumps(res, indent=2))
    print(prefix + pid, json.dumps({k: v for k, v in res.items() if k != "child_tail"})[:1200], flush=True)


if __name__ == "__main__":
    argv = sys.argv[1:]
    hardened = "--hardened" in argv
    argv = [a for a in argv if a != "--hardened"]
    if argv[0] == "--child":
        child(argv[1], hardened)
    else:
        for p in argv:
            parent(p, hardened)
