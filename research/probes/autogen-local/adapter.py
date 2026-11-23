"""AutoGen code executors with `functions` (autogen-ext 0.7.5 = microsoft/autogen @ 8390985).

MODE "local" uses LocalCommandLineCodeExecutor, MODE "docker" uses DockerCommandLineCodeExecutor.
Both are driven through the public execute_code_blocks([CodeBlock(language="python")]) call,
the same call CodeExecutorAgent makes. The lookup tool is passed as `functions=[lookup]`:
the executor copies its source into functions.py in the work dir (_common.py:52-67) and the
guest imports it, so the tool body runs inside the executor process, not on the host.
"""
import asyncio
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
import warnings
from pathlib import Path

import psutil
from autogen_core import CancellationToken
from autogen_core.code_executor import CodeBlock, with_requirements

MODE = "local"
IMPL = f"autogen-{MODE}"
HARDENED_TIMEOUT = 10
RUN_IS_FRESH = True
warnings.simplefilter("ignore")
_loop = asyncio.new_event_loop()
_containers = []
_mem = {"bytes": 0}


@with_requirements(python_packages=[], global_imports=["time", "sys"])
def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    print("LOOKUP_CALL", file=sys.stderr)
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


class Session:
    def __init__(self, hardened):
        self.work = tempfile.TemporaryDirectory(prefix=f"{IMPL}-")
        kw = {"timeout": HARDENED_TIMEOUT} if hardened else {}
        if MODE == "local":
            from autogen_ext.code_executors.local import LocalCommandLineCodeExecutor
            self.ex = LocalCommandLineCodeExecutor(work_dir=self.work.name, functions=[lookup], **kw)
        else:
            from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor
            name = f"autogen-docker-probe-{uuid.uuid4().hex[:8]}"
            _containers.append(name)
            if hardened:
                kw["delete_tmp_files"] = True
            self.ex = DockerCommandLineCodeExecutor(container_name=name, work_dir=self.work.name, functions=[lookup], **kw)
        _loop.run_until_complete(self.ex.start())

    def run(self, code):
        r = _loop.run_until_complete(
            self.ex.execute_code_blocks([CodeBlock(language="python", code=code)], CancellationToken()))
        return {"ok": r.exit_code == 0, "stdout": r.output, "result": None,
                "error": None if r.exit_code == 0 else f"exit_code={r.exit_code}: {r.output[-1500:]}"}

    def close(self):
        _loop.run_until_complete(self.ex.stop())
        self.work.cleanup()


def new_session(hardened):
    return Session(hardened)


def lookup_call(id_expr):
    return f"lookup(id={id_expr})"


prelude = "from functions import lookup\n"
host_calls = lambda: 0  # noqa: E731  the tool body never runs on the host


def call_note(r):
    return f"{(r.get('stdout') or '').count('LOOKUP_CALL')} LOOKUP_CALL markers from inside the executor"


def _poll_container_mem():
    while True:
        time.sleep(0.5)
        total = 0
        for name in list(_containers):
            try:
                out = subprocess.run(["docker", "exec", name, "cat", "/sys/fs/cgroup/memory.current"],
                                     capture_output=True, text=True, timeout=5).stdout.strip()
                total += int(out) if out.isdigit() else 0
            except Exception:
                pass
        _mem["bytes"] = total


if MODE == "docker":
    threading.Thread(target=_poll_container_mem, daemon=True).start()


def extra_rss():
    return _mem["bytes"]


def kill_all():
    for p in psutil.Process().children(recursive=True):
        try:
            p.kill()
        except psutil.Error:
            pass
    for name in _containers:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


CODES = {
    "P9": ("from functions import lookup\nimport asyncio, time\n"
           "async def main():\n    return await asyncio.gather(*[asyncio.to_thread(lookup, id=i) for i in [1, 2, 3, 4, 5]])\n"
           "t = time.time()\nasyncio.run(main())\nprint(int((time.time() - t) * 1000))"),
    "P2": 'print("A" * 200000)\n"RETURNED"',
}
from core import CANARY  # noqa: E402

EXTRAS = {
    "P9-loop": ("from functions import lookup\nimport time\nt = time.time()\nrs = [lookup(id=i) for i in [1, 2, 3, 4, 5]]\nprint(int((time.time() - t) * 1000))", "serial loop form"),
    "P4-canary": (f'print(open("{CANARY}").read())', "a host file inside the repo (not mounted into Docker)"),
    "P4-workdir": ('import os\nprint(os.getcwd(), sorted(os.listdir(".")))', "what the guest sees in its working directory"),
    "P8-files": (['open("kept.txt", "w").write("7")\nprint("wrote")', 'import os\nprint(open("kept.txt").read() if os.path.exists("kept.txt") else "gone")'], "files written by one execution, read by the next"),
    "P6-orphan": ('import subprocess\nsubprocess.Popen(["sleep", "97"])\nwhile True:\n    pass', "does the timeout kill children of the guest process"),
    "P12-whoami": ('import os, platform\nprint(os.getuid(), platform.platform())', "guest identity"),
    "shell-block": ("import subprocess\nprint(subprocess.run(['sh', '-c', 'echo shell-ok; uname -s'], capture_output=True, text=True).stdout)", "subprocess from guest"),
}
