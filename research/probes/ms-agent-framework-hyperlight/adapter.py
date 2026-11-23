"""Microsoft Agent Framework CodeAct with Hyperlight (agent-framework-hyperlight 1.0.0b261112).

Runs code through the public HyperlightExecuteCodeTool(...).invoke(arguments={"code": ...}),
the execute_code tool an Agent calls. Only runs with hyperlight-sandbox 0.10.0, which ships
macOS arm64 wheels (Hypervisor.framework); the package pins <0.10 (see out/attempt-*.txt).
"""
import asyncio
import os
import time

import psutil
from agent_framework import tool
from agent_framework_hyperlight import HyperlightExecuteCodeTool

IMPL = "ms-agent-framework-hyperlight"
HARDENED_TIMEOUT = 10.0
RUN_IS_FRESH = False
_loop = asyncio.new_event_loop()
_calls = {"n": 0}


@tool
def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    _calls["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


class Session:
    def __init__(self, hardened):
        kw = {"execution_timeout_seconds": HARDENED_TIMEOUT} if hardened else {}
        if os.environ.get("HL_DETAILED") == "1":
            kw["include_detailed_errors"] = True
        self.tool = HyperlightExecuteCodeTool(tools=[lookup], approval_mode="never_require", **kw)

    def run(self, code):
        contents = _loop.run_until_complete(self.tool.invoke(arguments={"code": code}))
        texts, errors = [], []
        for c in contents:
            if c.type == "error":
                errors.append(f"{c.message} | details={c.error_details}")
            elif c.type == "text":
                texts.append(c.text)
            else:
                texts.append(f"[{c.type}]")
        return {"ok": not errors, "stdout": "\n".join(texts), "result": None,
                "error": "; ".join(errors) or None}

    def close(self):
        self.tool._registry.close()  # internal: frees the sandbox on its owner thread; there is no public close


def new_session(hardened):
    return Session(hardened)


def lookup_call(id_expr):
    return f'call_tool("lookup", id={id_expr})'


prelude = ""
host_calls = lambda: _calls["n"]  # noqa: E731
extra_rss = lambda: 0  # noqa: E731


def kill_all():
    pass


from core import PWN_MARK, CANARY  # noqa: E402

CODES = {
    "P12c": f'import subprocess\nprint(subprocess.run(["sh", "-c", "echo PWNED-c >> {PWN_MARK}"]).returncode)',
}
EXTRAS = {
    "P2-sizes": ([f'print("A" * {n})' for n in (10000, 16000, 20000, 30000, 40000, 50000, 200000)] + ['print("after-crash")'], "largest print that survives, and whether the same tool recovers after the abort"),
    "P4-canary": (f'print(open("{CANARY}").read())', "a host file inside the repo"),
    "P4-listdir": ('import os\nprint(os.listdir("/"))', "guest root filesystem"),
    "P5-environ": ('import os\nprint(dict(os.environ))', "whole guest environment"),
    "P9-asyncio": ('import asyncio, time\nt = time.time()\nasync def one(i):\n    return call_tool("lookup", id=i)\nasync def main():\n    return await asyncio.gather(*[one(i) for i in [1, 2, 3, 4, 5]])\nasyncio.run(main())\nprint(int((time.time() - t) * 1000))', "asyncio.gather over the sync call_tool"),
    "P9-threads": ('import threading, time\nt = time.time()\nth = [threading.Thread(target=call_tool, args=("lookup",), kwargs={"id": i}) for i in [1, 2, 3, 4, 5]]\n[x.start() for x in th]\n[x.join() for x in th]\nprint(int((time.time() - t) * 1000))', "threads"),
    "P10-trace": ('x = 1\nraise ValueError("probe-boom")', "same as P10 (default include_detailed_errors=False)"),
    "P12-sys": ('import sys, os\nprint(sys.platform, sys.version, os.name, hasattr(os, "system"))', "what runtime the guest is"),
    "P12-socket": ('import socket\ns = socket.socket()\ns.connect(("93.184.215.14", 80))\nprint("connected")', "raw socket"),
    "P8-files": (['open("/tmp/kept.txt", "w").write("7")\nprint("wrote")', 'import os\nprint(open("/tmp/kept.txt").read() if os.path.exists("/tmp/kept.txt") else "gone")'], "guest files across executions"),
}
