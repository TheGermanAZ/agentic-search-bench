"""Hermes Agent execute_code adapter (NousResearch/hermes-agent v0.23.3, source checkout).

Each probe execution calls tools.code_execution_tool.execute_code(code, task_id=..., enabled_tools=...),
the function the registered `execute_code` tool handler dispatches to (code_execution_tool.py:930-944);
its JSON string is what the model sees. One task_id per probe session, so P8's two calls share the
session kernel.

`lookup` is not reachable through any public option: the in-sandbox tool set is the hardcoded
SANDBOX_ALLOWED_TOOLS (code_execution_tool.py:40-42) and stubs come from the module dict _TOOL_STUBS
(code_execution_tool.py:125-148). The adapter therefore (1) registers `lookup` with
tools.registry.registry.register (the API built-in tools and plugins use) and (2) adds it to those two
module globals in-process. The extras P1t/P9t use the built-in `terminal` tool instead, with no patch.

HERMES_HOME points at research/impls/hermes-execute-code/home (default) or home-hardened (hardened),
so nothing in ~/.hermes is read; both config.yaml files turn shared-metrics telemetry off.
"""

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

IMPL = Path(__file__).resolve().parents[4] / "impls" / "hermes-execute-code"  # verify copy: path depth adjusted
CONFIG = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "child" else os.environ.get("HERMES_PROBE_CONFIG", "default")
os.environ["HERMES_HOME"] = str(IMPL / ("home-hardened" if CONFIG == "hardened" else "home"))
os.environ["OTEL_SDK_DISABLED"] = "true"
# Two extra host variables for the env-scrub extras: a credential whose name does not match the
# secret-substring list but starts with a "safe" prefix, and a plain one.
os.environ["PATHFINDER_DB_URL"] = "postgres://probe:hunter2@db.invalid/x"
os.environ["PROBE_PLAIN_VALUE"] = "plain-v"
sys.path.insert(0, str(IMPL / "src"))

from probe_core import log_call  # noqa: E402
from tools.registry import registry  # noqa: E402
import model_tools  # noqa: E402,F401  (tool discovery, as the agent does)
import tools.code_execution_tool as cet  # noqa: E402
# verify copy: prefix container names with the impl (Hermes hardcodes hermes-<hex>), for the shared-machine rule.
import tools.environments.docker as _hdocker  # noqa: E402
_orig_rc = _hdocker.DockerEnvironment._run_command
_hdocker.DockerEnvironment._run_command = lambda self, name, wd: _orig_rc(self, "hermes-execute-code-" + name.removeprefix("hermes-"), wd)

PRELUDE = "from hermes_tools import lookup\n"
OUT_DIR = Path(__file__).resolve().parent / "out"


def call(i):
    return f"lookup(id={i})"


def coro(i):
    return None  # generated stubs are synchronous (code_execution_tool.py:205)


def value(var):
    return f'{var}["value"]'


def _lookup_handler(args, **kw):
    i = args["id"]
    start = time.time()
    time.sleep(0.2)
    log_call(i, start, time.time())
    return json.dumps({"id": i, "value": i * 2})


registry.register(
    name="lookup", toolset="probe",
    schema={"name": "lookup", "description": "Waits 200 ms, then returns {id, value: id * 2}.",
            "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}},
    handler=_lookup_handler,
)
cet.SANDBOX_ALLOWED_TOOLS = cet.SANDBOX_ALLOWED_TOOLS | {"lookup"}
cet._TOOL_STUBS["lookup"] = ("id: int", '"""Waits 200 ms, then returns {id, value: id * 2}."""', '{"id": id}')
ENABLED = ["lookup", "terminal", "read_file", "write_file"]


async def open_session(config):
    return {"task_id": f"probe-{uuid.uuid4().hex[:8]}"}


async def close_session(sess):
    from tools.code_kernel import shutdown_all_kernels
    await asyncio.to_thread(shutdown_all_kernels)
    try:
        from tools.terminal_tool import cleanup_vm
        await asyncio.to_thread(cleanup_vm, sess["task_id"])
    except Exception:
        pass


async def run(sess, code):
    raw = await asyncio.to_thread(cet.execute_code, code, task_id=sess["task_id"], enabled_tools=ENABLED)
    try:
        body = json.loads(raw)
    except ValueError:
        body = {"status": "?", "output": raw}
    ok = body.get("status") == "success"
    out = {"ok": ok, "stdout": body.get("output") or "", "model_sees": raw[:4000], "status": body.get("status"),
           "tool_calls_made": body.get("tool_calls_made"), "model_sees_len": len(raw)}
    if not ok:
        out["error"] = (body.get("error") or "") + "\n" + (body.get("output") or "")
    return out


P5_SCRUB = ("import os, subprocess\n"
            "ppid = os.getppid()\n"
            "print('PATHFINDER_DB_URL', os.environ.get('PATHFINDER_DB_URL'))\n"
            "print('PROBE_PLAIN_VALUE', os.environ.get('PROBE_PLAIN_VALUE'))\n"
            "print('HERMES_RPC_TOKEN set:', bool(os.environ.get('HERMES_RPC_TOKEN')))\n"
            "# the host process is the kernel's parent: ask ps for that one pid's environment\n"
            "env = subprocess.run(['ps', '-E', '-ww', '-o', 'command=', '-p', str(ppid)], capture_output=True, text=True).stdout\n"
            "print('PARENT_ENV has PROBE_SECRET=s3cr3t:', 'PROBE_SECRET=s3cr3t' in env, '| ps output chars:', len(env))")

EXTRA_PROBES = {
    "P1t": ["from hermes_tools import terminal\nr = terminal('sleep 0.2; echo $((21*2))')\nprint(r['output'])"],
    "P9t": ["from hermes_tools import terminal\nimport time\nt = time.time()\nfor i in range(5):\n    terminal('sleep 0.2')\nprint(round((time.time() - t) * 1000))"],
    "P9threads": [PRELUDE + "from concurrent.futures import ThreadPoolExecutor\nwith ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lambda i: lookup(id=i), [1, 2, 3, 4, 5]))\nprint(sum(r['value'] for r in rs))"],
    "P5scrub": [P5_SCRUB],
    "Pcap": ['print("B" * 120000)'],
    "Pwrite": ["import os\np = os.path.join(" + repr(str(OUT_DIR)) + ", 'hermes-write-probe.txt')\nopen(p, 'w').write('x')\nmsg = 'WROTE ' + str(os.path.exists(p))\nos.remove(p)\nprint(msg)"],
    "Ptoolcap": [PRELUDE + "n = 0\nfor i in range(55):\n    r = lookup(id=i)\n    if 'value' in r:\n        n += 1\nprint('ok calls', n)"],
}
# After the memory probe, does the same session run the next cell?
EXTRA_PROBES["P7next"] = ['a = []\nwhile True:\n    a.append("x" * 10**6)', "print('next cell', 1 + 1)"]
