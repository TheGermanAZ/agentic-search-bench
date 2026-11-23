"""Strands harness programmatic_tool_caller adapter.

A real `create_harness(...)` agent (strands-harness 0.4.0) with only the programmatic_tool_caller built-in
and one consumer tool, `lookup`. A stub Model satisfies the constructor and is never called. Each probe
execution is a direct tool call, `agent.tool.programmatic_tool_caller(code=...)`, which runs through the
same ToolExecutor._stream path a model's tool_use goes through (strands/tools/_caller.py:121-129), and
returns the ToolResult the model would see.
"""

import asyncio
import os

os.environ.setdefault("OTEL_SDK_DISABLED", "true")  # Strands only exports with OTEL_EXPORTER_OTLP_ENDPOINT; belt and braces

from strands import tool  # noqa: E402
from strands.models.model import Model  # noqa: E402

from probe_core import lookup_impl_async  # noqa: E402

PRELUDE = ""


def call(i):
    return f"await lookup(id={i})"


def coro(i):
    return f"lookup(id={i})"


def value(var):
    return f'{var}["value"]'


class StubModel(Model):
    """Never called: the probes invoke the tool directly, with no model turn."""

    def __init__(self):
        self.config = {"model_id": "stub"}

    def update_config(self, **c):
        self.config.update(c)

    def get_config(self):
        return self.config

    async def structured_output(self, *a, **k):
        raise RuntimeError("stub model")
        yield  # pragma: no cover

    async def stream(self, *a, **k):
        raise RuntimeError("stub model")
        yield  # pragma: no cover


@tool
async def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    return await lookup_impl_async(id)


# Hardened: the only public knobs are ProgrammaticToolCallerConfig.allowed_tools and .timeout
# (strands_harness/types/agent.py:82-92). _LIMITS (60 s VM time, 256 MiB, 1000 suspensions) is a
# module constant with no option. 10 s is a strict wall clock that still lets P9 (0.2 s) run.
HARDENED_PTC = {"allowed_tools": ["lookup"], "timeout": 10.0}


async def open_session(config):
    from strands_harness import create_harness

    ptc = HARDENED_PTC if config == "hardened" else True
    agent = create_harness(
        model=StubModel(),
        tools=[lookup],
        builtin_tools={"*": False, "programmatic_tool_caller": ptc},
        session=False,
        skills=False,
        memory=False,
    )
    return agent


async def close_session(agent):
    pass


async def run(agent, code):
    res = await asyncio.to_thread(agent.tool.programmatic_tool_caller, code=code, record_direct_tool_call=False)
    text = "\n".join(b.get("text", "") for b in res.get("content", []) if isinstance(b, dict))
    out = {"ok": res.get("status") == "success", "stdout": text if res.get("status") == "success" else "", "status": res.get("status")}
    if not out["ok"]:
        out["error"] = text
    return out


# Extras beyond SPEC.
EXTRA_PROBES = {
    # print well past the 200,000-char output cap
    "Pcap": ['print("B" * 300000)'],
    # 12 gathered lookups vs the 10-slot semaphore (_MAX_CONCURRENT_TOOL_CALLS)
    "P9wide": ["import asyncio\nrs = await asyncio.gather(*[lookup(id=i) for i in range(12)])\nprint(sum(x['value'] for x in rs))"],
    # deep recursion: does the VM's recursion limit stop it cleanly?
    "Precur": ["def f(n):\n    return f(n + 1)\nf(0)"],
    # time module / clock access inside Monty
    "Pclock": ["import time\nprint(time.time())"],
}
