"""Agno CodeMode adapter (agno 3.2.1, extra [code]).

`CodeMode(tools=[lookup])` binds the async `lookup` function into a per-session IPython kernel as the
awaitable handle `lookup`. Each probe execution calls the model-facing tool method
`CodeMode.aexecute(run_context, code)`, the function an Agent dispatches for the `execute` tool, and the
ToolResult.content string is what the model would see. One CodeMode instance and one session_id per
probe "session"; P8's two executions share it. No LLM.
"""

import os

os.environ.setdefault("AGNO_TELEMETRY", "false")  # agno/agent/_init.py:62-66; set before any agno import

import uuid  # noqa: E402
from pathlib import Path  # noqa: E402

os.environ["PROBE_OUT_DIR"] = str(Path(__file__).resolve().parent / "out")  # target for the Pwrite extra

from agno.run import RunContext  # noqa: E402
from agno.tools.code import CodeMode  # noqa: E402

from probe_core import lookup_impl_async  # noqa: E402

PRELUDE = ""


def call(i):
    return f"await lookup(id={i})"


def coro(i):
    return f"lookup(id={i})"


def value(var):
    return f'{var}["value"]'


async def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    return await lookup_impl_async(id)


# Hardened: the strictest documented constructor options (code_mode.py:233-257). timeout bounds every cell;
# allow_shell=False strips the %%bash magic ("Footgun reducer, not a boundary", kernel.py:416-418);
# allow_restart=False drops the restart tool; snapshot=False keeps no dill state; on_busy_kernel="restart" restarts a
# kernel still busy from a timed-out cell instead of waiting (code_mode.py:245). There is no memory, network,
# filesystem or env-scrubbing option: env= is laid over os.environ, never replacing it (kernel.py:283-286, 391-392).
HARDENED = {"timeout": 10, "allow_shell": False, "allow_restart": False, "snapshot": False, "on_busy_kernel": "restart"}


async def open_session(config):
    cm = CodeMode(tools=[lookup], **(HARDENED if config == "hardened" else {}))
    ctx = RunContext(run_id=str(uuid.uuid4()), session_id=str(uuid.uuid4()))
    return {"cm": cm, "ctx": ctx}


async def close_session(sess):
    await sess["cm"].aclose()


async def run(sess, code):
    res = await sess["cm"].aexecute(sess["ctx"], code)
    text = res.content if hasattr(res, "content") else str(res)
    failed = "Traceback" in text or "Error" in text.split("\n", 1)[0] or "timed out" in text.lower()
    out = {"ok": not failed, "stdout": text}
    if failed:
        out["error"] = text
    return out


EXTRA_PROBES = {
    "Pcap": ['print("B" * 100000)'],
    # write outside the cwd: can the cell modify host files? (writes then deletes a file in this probe folder's out/)
    "Pwrite": ["import os\np = os.path.join(os.environ['PROBE_OUT_DIR'], 'agno-write-probe.txt')\nopen(p, 'w').write('x')\nmsg = 'WROTE ' + str(os.path.exists(p))\nos.remove(p)\nprint(msg)"],
    # the kernel can reach the host shell
    "Pshell": ["!echo SHELL-$((40+2))"],
}

# A loop that swallows KeyboardInterrupt (Agno's timeout is an interrupt, kernel.py:643-647), then a cell
# that asks whether the first one is still burning CPU in the same kernel.
EXTRA_PROBES["P6swallow"] = [
    "while True:\n    try:\n        while True:\n            pass\n    except BaseException:\n        pass",
    "import os\nprint('second cell ran in pid', os.getpid())",
]
