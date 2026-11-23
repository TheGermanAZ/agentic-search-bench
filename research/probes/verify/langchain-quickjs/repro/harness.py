"""Runs one SPEC probe against langchain-quickjs through a real LangChain agent.

The model is a scripted stand-in: on a human message it emits one `eval` tool call
whose code is that message, and after the tool result it stops. No LLM is involved.
Usage: harness.py <default|hardened> <P1..P12>
"""

import asyncio
import json
import math
import os
import statistics
import sys
import time
import uuid
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

T_IMPORT0 = time.perf_counter()
from langchain.agents import create_agent  # noqa: E402
from langchain_core.callbacks import AsyncCallbackHandler  # noqa: E402
from langchain_core.language_models import BaseChatModel  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402
from langchain_core.outputs import ChatGeneration, ChatResult  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

from langchain_quickjs import CodeInterpreterMiddleware  # noqa: E402

T_IMPORT_MS = (time.perf_counter() - T_IMPORT0) * 1000

OUT = Path(__file__).resolve().parent / "out"

CONFIGS = {
    "default": {"ptc": ["lookup"]},
    "hardened": {
        "ptc": ["lookup"],
        "timeout": 1.0,
        "memory_limit": 16 * 1024 * 1024,
        "max_ptc_calls": 8,
        "mode": "call",
        "subagents": False,
    },
}

HOST_CALLS = 0


@tool
async def lookup(id: int) -> dict:
    """Look up a record by id."""
    global HOST_CALLS
    HOST_CALLS += 1
    await asyncio.sleep(0.2)
    return {"id": id, "value": id * 2}


class ScriptedModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        last = messages[-1]
        if isinstance(last, HumanMessage):
            msg = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "eval",
                        "args": {"code": last.content},
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "type": "tool_call",
                    }
                ],
            )
        else:
            msg = AIMessage(content="done")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        return self._generate(messages, stop, run_manager, **kwargs)


class EvalTimer(AsyncCallbackHandler):
    def __init__(self):
        self.starts = {}
        self.eval_ms = []

    async def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):
        if (serialized or {}).get("name") == "eval":
            self.starts[run_id] = time.perf_counter()

    async def on_tool_end(self, output, *, run_id, **kwargs):
        if run_id in self.starts:
            self.eval_ms.append((time.perf_counter() - self.starts.pop(run_id)) * 1000)


def build(config_name):
    mw = CodeInterpreterMiddleware(**CONFIGS[config_name])
    agent = create_agent(
        model=ScriptedModel(),
        tools=[lookup],
        middleware=[mw],
        checkpointer=InMemorySaver(),
    )
    return agent


async def run(agent, code, thread_id):
    """One execution: one agent turn carrying exactly one eval call."""
    global HOST_CALLS
    before = HOST_CALLS
    timer = EvalTimer()
    t0 = time.perf_counter()
    result = await agent.ainvoke(
        {"messages": [HumanMessage(content=code)]},
        config={"configurable": {"thread_id": thread_id}, "callbacks": [timer]},
    )
    turn_ms = (time.perf_counter() - t0) * 1000
    tool_msgs = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    return {
        "code": code,
        "output": tool_msgs[-1].content if tool_msgs else None,
        "turn_ms": round(turn_ms, 1),
        "eval_ms": round(timer.eval_ms[-1], 1) if timer.eval_ms else None,
        "host_calls": HOST_CALLS - before,
    }


def tid():
    return f"t-{uuid.uuid4().hex[:8]}"


def try_each(lines):
    """Wrap each attempt so one failure does not hide the next."""
    body = "\n".join(
        f"try {{ out[{json.dumps(k)}] = String({expr}); }} "
        f"catch (e) {{ out[{json.dumps(k)}] = 'THREW ' + e.name + ': ' + e.message; }}"
        for k, expr in lines
    )
    return "const out = {};\n" + body + "\nJSON.stringify(out, null, 1)"


STEPS = {
    "P1": ["const r = await tools.lookup({id: 21}); console.log(r.value)"],
    "P2": ['console.log("A".repeat(200000)); "RETURNED"'],
    "P3": [
        'await fetch("https://example.com")',
        try_each(
            [
                ("fetch", "typeof fetch"),
                ("XMLHttpRequest", "typeof XMLHttpRequest"),
                ("WebSocket", "typeof WebSocket"),
                ("importHttps", '(await import("https://example.com")).default'),
                ("importOs", 'Object.keys(await import("os")).join(",")'),
            ]
        ),
    ],
    "P4": [
        'require("fs").readFileSync("/etc/hosts","utf8")',
        try_each(
            [
                ("require", 'require("fs").readFileSync("/etc/hosts","utf8")'),
                ("importFs", '(await import("fs")).readFileSync("/etc/hosts","utf8")'),
                ("Deno", 'await Deno.readTextFile("/etc/hosts")'),
                ("std", 'std.loadFile("/etc/hosts")'),
                ("fsGlobal", "typeof fs"),
                ("lcFsType", "typeof __lc_fs"),
            ]
        ),
        'await __lc_fs("readFile", {path: "/etc/hosts"})',
    ],
    "P5": [
        "process.env.PROBE_SECRET",
        try_each(
            [
                ("process", "typeof process"),
                ("std", 'std.getenv("PROBE_SECRET")'),
                ("importStd", '(await import("std")).getenv("PROBE_SECRET")'),
                ("scriptArgs", "typeof scriptArgs"),
            ]
        ),
    ],
    "P6": ["while (true) {}"],
    "P8": ["globalThis.kept = 7", 'console.log(typeof kept === "undefined" ? "gone" : kept)'],
    "P9": [
        "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id:i}))); "
        "console.log(Date.now()-t)"
    ],
    "P10": [
        'throw new Error("probe-boom")',
        'const x = 1;\nfunction f() {\n  throw new Error("probe-boom");\n}\nf();',
    ],
    "P12": [
        'this.constructor.constructor("return process")()',
        "(function(){return this})().process",
        try_each(
            [
                ("ctorProcess", 'typeof this.constructor.constructor("return process")()'),
                ("sloppyThisProcess", "typeof (function(){return this})().process"),
                ("fnTypeofProcess", 'Function("return typeof process")()'),
                ("std", "typeof std"),
                ("os", "typeof os"),
                ("Deno", "typeof Deno"),
                ("Bun", "typeof Bun"),
                ("hostFns", "Object.getOwnPropertyNames(globalThis).filter(n => n.startsWith('__') || n === 'tools' || n === 'task' || n === 'console').join(',')"),
                ("globals", "Object.getOwnPropertyNames(globalThis).length"),
            ]
        ),
        'await __tools_call("lookup", {id: 1}).then(r => JSON.stringify(r))',
    ],
}


async def probe_steps(agent, pid):
    thread = tid()
    return [await run(agent, code, thread) for code in STEPS[pid]]


async def probe_p7(agent):
    """P7 plus a neighbour session running a tool call at the same time."""
    victim, neighbour = tid(), tid()
    p7 = asyncio.create_task(
        run(agent, 'const a = []; while (true) a.push("x".repeat(1e6))', victim)
    )
    await asyncio.sleep(0.05)
    side = await run(agent, "const r = await tools.lookup({id: 3}); r.value", neighbour)
    main = await p7
    after_same = await run(agent, "1 + 1", victim)
    after_other = await run(agent, "2 + 2", neighbour)
    return [main, {"neighbour_during": side}, {"same_thread_after": after_same}, {"other_thread_after": after_other}]


async def probe_p11(config_name):
    t0 = time.perf_counter()
    agent = build(config_name)
    build_ms = (time.perf_counter() - t0) * 1000
    cold = await run(agent, "1+1", tid())
    warm = [await run(agent, "1+1", tid()) for _ in range(20)]

    def stats(key):
        xs = sorted(r[key] for r in warm)
        return {"median": round(statistics.median(xs), 2), "p90": round(xs[math.ceil(0.9 * len(xs)) - 1], 2), "min": xs[0], "max": xs[-1]}

    return {
        "import_ms": round(T_IMPORT_MS, 1),
        "build_agent_ms": round(build_ms, 1),
        "first_execution": cold,
        "fresh_thread_executions": 20,
        "turn_ms": stats("turn_ms"),
        "eval_ms": stats("eval_ms"),
        "sample_output": warm[0]["output"],
    }


async def main(config_name, pid):
    assert os.environ.get("PROBE_SECRET") == "s3cr3t", "PROBE_SECRET must be set by the runner"
    if pid == "P11":
        data = await probe_p11(config_name)
    else:
        agent = build(config_name)
        data = await (probe_p7(agent) if pid == "P7" else probe_steps(agent, pid))
    prefix = "" if config_name == "default" else "hardened-"
    record = {"config": config_name, "middleware_kwargs": CONFIGS[config_name], "probe": pid, "result": data}
    text = json.dumps(record, indent=1, ensure_ascii=False)
    (OUT / f"{prefix}{pid}.txt").write_text(text + "\n")
    print(text if len(text) < 20000 else text[:20000] + "\n...[harness print cut; full file in out/]")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
