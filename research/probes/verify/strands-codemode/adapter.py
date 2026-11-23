"""Strands harness programmatic_tool_caller adapter (strands-harness 0.4.0, Monty 0.0.23).

Same entry point as the worker harness (research/probes/strands-codemode/adapter.py): a real create_harness(...)
agent with a stub model, and agent.tool.programmatic_tool_caller(code=...), which runs through the same
ToolExecutor._stream path as a model's tool_use. Shared instance: ONE Python process (one event loop, one
module-level tool registry and Monty package). A Strands Agent refuses concurrent invocations
(ConcurrencyException, strands/tools/_caller.py:102-107), so a multi-user server holds one agent per
conversation; each execution here gets its own agent (its own user), all in the same process.

Only print() output reaches the model (programmatic_tool_caller.py:360), so a trailing bare expression in a
test program is rewritten to print(<expr>) before it is sent; nothing else in the code is changed.
"""
import ast
import asyncio
import os
import sys

os.environ.setdefault("OTEL_SDK_DISABLED", "true")
from strands import tool  # noqa: E402
from strands.models.model import Model  # noqa: E402

HARDENED_PTC = {"allowed_tools": ["lookup", "failing", "rich"], "timeout": 10.0}  # as results/strands-codemode.json hardened.config


class StubModel(Model):
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


def print_last(code):
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return code
    if not tree.body or not isinstance(tree.body[-1], ast.Expr):
        return code
    last = tree.body[-1]
    lines = code.split("\n")
    head = lines[: last.lineno - 1]
    expr = "\n".join(lines[last.lineno - 1 : last.end_lineno])
    return "\n".join(head + [f"print({expr})"])


class A:
    lang = "py"
    name = "strands-codemode"
    T = staticmethod(lambda args: f"lookup({args})")
    F = staticmethod(lambda args: "failing()")
    R = staticmethod(lambda args: "rich()")


async def make(config, host):
    from strands_harness import create_harness

    @tool
    async def lookup(id: int) -> dict:
        """Waits 200 ms, then returns {id, value: id * 2}."""
        return await host["lookup"](id)

    @tool
    async def failing() -> dict:
        """Always fails."""
        return await host["failing"]()

    @tool
    async def rich() -> dict:
        """Returns a rich object."""
        return await host["rich"]()

    ptc = HARDENED_PTC if config == "hardened" else True
    agents = []

    def new_agent():
        ag = create_harness(model=StubModel(), tools=[lookup, failing, rich], builtin_tools={"*": False, "programmatic_tool_caller": ptc},
                            session=False, skills=False, memory=False)
        agents.append(ag)
        return ag

    a = A()
    a.notes = (f"builtin_tools programmatic_tool_caller={ptc!r}; one process, one create_harness agent per execution "
               "(Strands agents reject concurrent calls); trailing expression rewritten to print()")

    async def exec(code):
        ag = new_agent()
        res = await asyncio.to_thread(ag.tool.programmatic_tool_caller, code=print_last(code), record_direct_tool_call=False)
        text = "\n".join(b.get("text", "") for b in res.get("content", []) if isinstance(b, dict))
        return {"status": res.get("status"), "text": text}

    a.exec = exec
    return a
