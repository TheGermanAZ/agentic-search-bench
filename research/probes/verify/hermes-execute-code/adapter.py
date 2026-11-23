"""Hermes Agent execute_code adapter, HARDENED Docker backend only (hermes-agent v0.23.3).

The default local backend already fails G1 (P4 reads /etc/hosts, P12 runs os.system on the host), so only the
hardened config is exercised: HERMES_HOME=research/impls/hermes-execute-code/home-hardened (terminal.backend=docker,
docker_network=false, container_memory=512, container_cpu=1, code_execution.mode=strict, timeout=10,
max_tool_calls=50). Entry point as in the worker harness (research/probes/hermes-execute-code/adapter.py):
tools.code_execution_tool.execute_code(code, task_id=..., enabled_tools=...), whose JSON string is what the model sees.

Shared instance: ONE Hermes process. Each execution is a separate conversation (fresh task_id), so it gets its own
container and session kernel, as two users of one Hermes gateway would. In-process patches, as in the worker harness:
(1) lookup/failing/rich registered with registry.register and added to SANDBOX_ALLOWED_TOOLS/_TOOL_STUBS (no public
option exists); (2) container names prefixed `hermes-execute-code-` (Hermes hardcodes `hermes-<hex>`,
tools/environments/docker.py:1039) so the shared-machine cleanup rule can find them; the asb-impl label stays.

The guest is synchronous CPython (stubs are sync, no top-level await, only stdout returns), so `await ` is stripped,
a trailing bare expression is printed, and R5/R7a/R7b use threads/time.sleep for the same intent (override_codes).
"""
import ast
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

IMPL = Path(__file__).resolve().parents[3] / "impls" / "hermes-execute-code"
os.environ["HERMES_HOME"] = str(IMPL / "home-hardened")
os.environ["OTEL_SDK_DISABLED"] = "true"
sys.path.insert(0, str(IMPL / "src"))

from tools.registry import registry  # noqa: E402
import model_tools  # noqa: E402,F401
import tools.code_execution_tool as cet  # noqa: E402
import tools.environments.docker as hdocker  # noqa: E402

_orig_run_command = hdocker.DockerEnvironment._run_command


def _prefixed(self, name, workdir):
    return _orig_run_command(self, "hermes-execute-code-" + name.removeprefix("hermes-"), workdir)


hdocker.DockerEnvironment._run_command = _prefixed


def strip_and_print(code):
    code = code.replace("await ", "")
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return code
    if not tree.body or not isinstance(tree.body[-1], ast.Expr):
        return code
    last = tree.body[-1]
    lines = code.split("\n")
    return "\n".join(lines[: last.lineno - 1] + ["print(" + "\n".join(lines[last.lineno - 1: last.end_lineno]) + ")"])


PRE = "from hermes_tools import lookup, failing, rich\n"


class A:
    lang = "py"
    name = "hermes-execute-code"
    T = staticmethod(lambda args: f"lookup({args})")
    F = staticmethod(lambda args: "failing()")
    R = staticmethod(lambda args: "rich()")

    @staticmethod
    def override_codes(c):
        return {
            # Hermes returns a failed tool call as a value ({"error": ...}), so print what the guest received too.
            "R2b": 'try:\n    r = failing()\n    o = ["no throw", str(r)[:600]]\nexcept Exception as e:\n    o = [type(e).__name__, str(e)[:500]]\no',
            "R5": "from concurrent.futures import ThreadPoolExecutor\nwith ThreadPoolExecutor(64) as ex:\n    rs = list(ex.map(lambda i: lookup(id=i), range(2000)))\nlen(rs)",
            "R7a": 'import time\ntime.sleep(100000)\n"resolved?"',
            "R7b": "import threading\nfor i in range(5):\n    threading.Thread(target=lookup, kwargs={'id': i}).start()\nwhile True:\n    pass",
        }


async def make(config, host):
    if config != "hardened":
        raise RuntimeError("hermes-execute-code: only the hardened Docker config is tested (default fails G1)")
    loop = asyncio.get_running_loop()

    def sync(coro_fn):
        def handler(args, **kw):
            r = asyncio.run_coroutine_threadsafe(coro_fn(args), loop).result()
            return json.dumps(r, default=repr)
        return handler

    for name, desc, props, req, fn in [
        ("lookup", "Waits 200 ms, then returns {id, value: id * 2}.", {"id": {"type": "integer"}}, ["id"], lambda a: host["lookup"](a["id"])),
        ("failing", "Always fails.", {}, [], lambda a: host["failing"]()),
        ("rich", "Returns a rich object.", {}, [], lambda a: host["rich"]()),
    ]:
        registry.register(name=name, toolset="probe", schema={"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": req}}, handler=sync(fn))
    cet.SANDBOX_ALLOWED_TOOLS = cet.SANDBOX_ALLOWED_TOOLS | {"lookup", "failing", "rich"}
    cet._TOOL_STUBS["lookup"] = ("id: int", '"""Waits 200 ms, then returns {id, value: id * 2}."""', '{"id": id}')
    cet._TOOL_STUBS["failing"] = ("", '"""Always fails."""', "{}")
    cet._TOOL_STUBS["rich"] = ("", '"""Returns a rich object."""', "{}")
    enabled = ["lookup", "failing", "rich", "terminal", "read_file", "write_file"]
    from tools.terminal_tool_lifecycle import cleanup_vm

    tasks = []
    a = A()
    a.notes = "HERMES_HOME=home-hardened (docker, no network, 512 MB, 1 CPU, strict, timeout 10 s, 50 calls); one process, fresh task_id (container + kernel) per execution"

    async def exec(code):
        tid = f"verify-{uuid.uuid4().hex[:8]}"
        tasks.append(tid)
        raw = await asyncio.to_thread(cet.execute_code, PRE + strip_and_print(code), task_id=tid, enabled_tools=enabled)
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"raw": raw}
        # Release this conversation's container in the background (a server would on session end).
        asyncio.ensure_future(asyncio.to_thread(cleanup_vm, tid, force_remove=True))
        return {"status": body.get("status"), "output": body.get("output"), "error": body.get("error"), "tool_calls_made": body.get("tool_calls_made"), "model_sees_chars": len(raw), "model_sees_head": raw[:1500]}

    a.exec = exec

    async def stats():
        return {"tasks": len(tasks)}

    a.stats = stats
    return a
