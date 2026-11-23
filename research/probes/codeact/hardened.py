"""RUBRIC hardened run for CodeAct: the repo's containerized code execution engine.

Uses JupyterGatewayDocker + JupyterKernel from scripts/chat/code_execution/jupyter.py at d607f56, the same
calls the engine's API makes per conversation (api.py:66-90): one docker.io/xingyaoww/codeact-executor
container per session with RESOURCE_CONSTRAINTS mem_limit='8g', nano_cpus=2e9 (jupyter.py:240-245), and
JupyterKernel.execute(code, timeout=60) (jupyter.py:136, 209-213).
Harness-only changes: the host port is pinned to 41910 (the class otherwise asks the OS for any free port),
and containers are named codeact-hardened-<probe>.

The engine has no host-tool bridge: tools are code strings run inside the kernel (jupyter.py:73-81), so P9
defines lookup in the kernel through that hook and is recorded as not-applicable for host calls.

Usage:
    PY=../../impls/codeact/.venv-engine/bin/python
    PROBE_SECRET=s3cr3t $PY hardened.py P3 P4 P5 P6 P9 P12
    PROBE_SECRET=s3cr3t ../mem-lock.sh $PY hardened.py P7
"""

import asyncio
import json
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE.parent.parent / "impls" / "codeact" / "repo" / "scripts" / "chat" / "code_execution"))
import jupyter  # noqa: E402

PORT = 41910
jupyter.JupyterGatewayDocker._get_free_port = lambda self: PORT

LOOKUP_TOOL = (
    "import time as _t\n"
    "def lookup(id):\n"
    "    _t.sleep(0.2)\n"
    "    return {'id': id, 'value': id * 2}\n"
)

CODE = {
    "P3": 'import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)',
    "P4": 'print(open("/etc/hosts").read())',
    "P5": 'import os\nprint(os.environ.get("PROBE_SECRET"))',
    "P6": "while True:\n    pass",
    "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
    "P9": ("import time, concurrent.futures\nt = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\n"
           "print('loop', int((time.time() - t) * 1000))\nt = time.time()\n"
           "with concurrent.futures.ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\n"
           "print('threads', int((time.time() - t) * 1000), sum(r['value'] for r in rs))"),
}
# P12 runs each attempt in a fresh container: a spawn that hangs would otherwise block the later attempts.
P12_ATTEMPTS = [
    "subs = ().__class__.__base__.__subclasses__()\nwc = [c for c in subs if c.__name__ == '_wrap_close']\nprint(len(subs), len(wc))",
    "print(__import__('os').system('echo PWNED'))",
    "wc = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close']\n"
    "print(wc[0].__init__.__globals__['system']('echo PWNED2'))",
    "import subprocess\nprint(subprocess.run(['sh', '-c', 'echo PWNED; hostname; id'], capture_output=True, text=True).stdout)",
    "import os\nprint(os.path.exists('/var/run/docker.sock'), os.path.exists('/Users'), os.uname().nodename)",
]
CODE["P12"] = "\n# --- next attempt, fresh container ---\n".join(P12_ATTEMPTS)


def watch_memory(container, stop, state):
    """Kill the container at 4 GiB of cgroup memory, the SPEC's host-RSS cap."""
    for s in container.stats(stream=True, decode=True):
        usage = s.get("memory_stats", {}).get("usage", 0)
        state["peak"] = max(state["peak"], usage)
        if usage > 4 * 1024**3:
            state["killed"] = time.monotonic()
            container.kill()
            return
        if stop.is_set():
            return


async def run(pid, code=None, suffix=""):
    code = code or CODE[pid]
    name = f"codeact-hardened-{pid}{suffix}"
    wrapper = jupyter.JupyterGatewayDocker(name=name)
    t0 = time.monotonic()
    url = wrapper.__enter__()
    startup = time.monotonic() - t0
    kernel = jupyter.JupyterKernel(url, convid=name)
    kernel.tools_to_run = []
    await kernel.initialize()
    if pid == "P9":
        await kernel.execute(LOOKUP_TOOL)
    stop, state = threading.Event(), {"peak": 0, "killed": None}
    if pid == "P7":
        threading.Thread(target=watch_memory, args=(wrapper.container, stop, state), daemon=True).start()
    t1 = time.monotonic()
    try:
        out = await asyncio.wait_for(kernel.execute(code), 125)
    except BaseException as e:  # noqa: BLE001
        out = f"<harness: {type(e).__name__}: {e}>"
    elapsed = time.monotonic() - t1
    after = None
    if pid in ("P6", "P7") and not state["killed"]:
        try:
            after = await asyncio.wait_for(kernel.execute("print(1 + 1)"), 30)
        except BaseException as e:  # noqa: BLE001
            after = f"<harness: {type(e).__name__}: {e}>"
    stop.set()
    try:
        await kernel.shutdown_async()
    except BaseException:  # noqa: BLE001
        pass
    try:
        wrapper.__exit__(None, None, None)
    except BaseException:  # noqa: BLE001
        pass
    return {"probe": pid, "container": name, "startup_s": round(startup, 1), "elapsed_s": round(elapsed, 2),
            "output": out, "after": after, "mem_peak_mib": round(state["peak"] / 1024**2),
            "harness_killed_at_4gib": state["killed"] is not None}


if __name__ == "__main__":
    for pid in sys.argv[1:]:
        if pid == "P12":
            res = {"probe": "P12", "attempts": [asyncio.run(run("P12", c, f"-{i}")) | {"code": c} for i, c in enumerate(P12_ATTEMPTS)]}
        else:
            res = asyncio.run(run(pid))
        res["config"] = "JupyterGatewayDocker RESOURCE_CONSTRAINTS={'mem_limit': '8g', 'nano_cpus': 2e9}, JupyterKernel.execute timeout=60"
        (OUT / f"hardened-{pid}.txt").write_text(f"code:\n{CODE[pid]}\n\n" + json.dumps(res, indent=2))
        (OUT / f"hardened-{pid}.json").write_text(json.dumps(res, indent=2))
        print(json.dumps(res)[:700], flush=True)
