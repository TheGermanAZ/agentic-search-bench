"""langgraph-codeact adapter. Drives the real graph from create_codeact(model, tools, eval_fn),
compiled with MemorySaver as in examples/math_example.py, with a scripted fake chat model in place
of Claude: each run feeds one fenced code block, then a plain "done" so the graph ends. The text
that comes back is the user message the sandbox node appends, i.e. what the model would see.

EVAL_KIND "eval": eval_fn is examples/math_example.py's eval, copied verbatim (importing the
example would call init_chat_model for Anthropic). EVAL_KIND "pyodide": eval_fn is
examples/pyodide_sandbox_example.py's create_pyodide_eval_fn(PyodideSandbox(...)), copied verbatim.
"""
import builtins
import contextlib
import inspect
import io
import os
import uuid
from collections import deque
from typing import Any

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from langgraph_codeact import EvalCoroutine, create_codeact
from probe_tools import lookup

EVAL_KIND = os.environ.get("LG_EVAL", "eval")
PRELUDE = ""


def call(i):
    return f"lookup({i})"


def coro(i):
    return None


def value(var):
    return f'{var}["value"]'


# ---- verbatim from examples/math_example.py (langgraph-codeact de14f16), lines 13-29 ----
def eval(code: str, _locals: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    # Store original keys before execution
    original_keys = set(_locals.keys())

    try:
        with contextlib.redirect_stdout(io.StringIO()) as f:
            exec(code, builtins.__dict__, _locals)
        result = f.getvalue()
        if not result:
            result = "<code ran, no output printed to stdout>"
    except Exception as e:
        result = f"Error during execution: {repr(e)}"

    # Determine new variables created during execution
    new_keys = set(_locals.keys()) - original_keys
    new_vars = {key: _locals[key] for key in new_keys}
    return result, new_vars


# ---- verbatim from examples/pyodide_sandbox_example.py (langgraph-codeact de14f16), lines 12-75 ----
def create_pyodide_eval_fn(sandbox) -> EvalCoroutine:
    """Create an eval_fn that uses PyodideSandbox.
    """

    async def async_eval_fn(
        code: str, _locals: dict[str, Any]
    ) -> tuple[str, dict[str, Any]]:
        # Create a wrapper function that will execute the code and return locals
        wrapper_code = f"""
def execute():
    try:
        # Execute the provided code
{chr(10).join("        " + line for line in code.strip().split(chr(10)))}
        return locals()
    except Exception as e:
        return {{"error": str(e)}}

execute()
"""
        # Convert functions in _locals to their string representation
        context_setup = ""
        for key, value in _locals.items():
            if callable(value):
                # Get the function's source code
                src = inspect.getsource(value)
                context_setup += f"\n{src}"
            else:
                context_setup += f"\n{key} = {repr(value)}"

        try:
            # Execute the code and get the result
            response = await sandbox.execute(
                code=context_setup + "\n\n" + wrapper_code,
                **HARDENED_EXECUTE_KWARGS,
            )

            # Check if execution was successful
            if response.stderr:
                return f"Error during execution: {response.stderr}", {}

            # Get the output from stdout
            output = (
                response.stdout
                if response.stdout
                else "<Code ran, no output printed to stdout>"
            )
            result = response.result

            # If there was an error in the result, return it
            if isinstance(result, dict) and "error" in result:
                return f"Error during execution: {result['error']}", {}

            # Get the new variables by comparing with original locals
            new_vars = {
                k: v
                for k, v in result.items()
                if k not in _locals and not k.startswith("_")
            }
            return output, new_vars

        except Exception as e:
            return f"Error during PyodideSandbox execution: {repr(e)}", {}

    return async_eval_fn
# ---- end of verbatim copies (one line added above: **HARDENED_EXECUTE_KWARGS, empty by default) ----

HARDENED_EXECUTE_KWARGS: dict = {}


class Feed:
    """Iterator the fake model pulls its next reply from."""

    def __init__(self):
        self.q = deque()

    def __iter__(self):
        return self

    def __next__(self):
        return AIMessage(content=self.q.popleft())


async def open_session(config):
    global HARDENED_EXECUTE_KWARGS
    feed = Feed()
    model = GenericFakeChatModel(messages=feed)
    # probes whose id ends in "s" register the self-contained variant of the tool
    if os.environ.get("PROBE_ID", "").endswith("s"):
        from probe_tools_selfcontained import lookup as tool
    else:
        tool = lookup
    if EVAL_KIND == "pyodide":
        from langchain_sandbox import PyodideSandbox

        if config == "hardened":
            sandbox = PyodideSandbox(allow_net=False)
            HARDENED_EXECUTE_KWARGS = {"timeout_seconds": 30, "memory_limit_mb": 256}
        else:
            sandbox = PyodideSandbox(allow_net=True)  # as in the example, line 111
        eval_fn = create_pyodide_eval_fn(sandbox)
    else:
        eval_fn = eval
    # LG_CKPT=memory compiles with MemorySaver as the examples do. The default compiles without a
    # checkpointer and passes the previous run's `context` back in as graph input, because with
    # MemorySaver any top-level import, def or class makes the checkpoint write fail (msgpack).
    if os.environ.get("LG_CKPT") == "memory":
        agent = create_codeact(model, [tool], eval_fn).compile(checkpointer=MemorySaver())
    else:
        agent = create_codeact(model, [tool], eval_fn).compile()
    return {"agent": agent, "feed": feed, "cfg": {"configurable": {"thread_id": str(uuid.uuid4())}}, "context": {}}


async def close_session(s):
    pass


async def run(s, code):
    s["feed"].q.extend([f"```python\n{code}\n```", "done"])
    inp = {"messages": [{"role": "user", "content": "run the probe"}]}
    if os.environ.get("LG_CKPT") != "memory":
        inp["context"] = s["context"]
    state = await s["agent"].ainvoke(inp, s["cfg"])
    s["context"] = state.get("context", {})
    sandbox_msgs = [m for m in state["messages"] if m.type == "human" and m.content != "run the probe"]
    out = sandbox_msgs[-1].content if sandbox_msgs else ""
    err = out if out.startswith("Error during") else None
    return {
        "ok": err is None,
        "stdout": out,
        "error": err,
        "context_keys": sorted(k for k in state.get("context", {}) if not k.startswith("__")),
        "host_builtins_leak": hasattr(builtins, "PROBE_LEAK"),
    }


EXTRA_PROBES = {
    # a function defined in the code calling a tool: its globals are builtins.__dict__
    "P8b": ["def helper():\n    return lookup(3)['value']\nprint(helper())"],
    "P1s": None,  # filled below: P1 and P9 code, run with lookup_selfcontained
    "P9s": None,
    # threads are allowed in plain exec; ex.map(lookup) avoids a lambda, whose globals would be
    # builtins.__dict__ and could not see lookup
    "P9b": ["from concurrent.futures import ThreadPoolExecutor\nwith ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lookup, [1, 2, 3, 4, 5]))\nprint(sum(x['value'] for x in rs))"],
    # does a function's `global` write land in the host process's builtins module?
    "P12d": ["def f():\n    global PROBE_LEAK\n    PROBE_LEAK = 'leaked'\nf()\nprint('set')"],
}


def _fill_selfcontained():
    import probe_core

    base = probe_core.probe_codes(type("A", (), {k: globals()[k] for k in ("call", "coro", "value", "PRELUDE")}))
    EXTRA_PROBES["P1s"], EXTRA_PROBES["P9s"] = base["P1"], base["P9"]


_fill_selfcontained()
