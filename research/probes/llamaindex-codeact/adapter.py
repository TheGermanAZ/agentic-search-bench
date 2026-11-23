"""LlamaIndex CodeActAgent adapter. Builds the agent exactly as the docs notebook does
(docs/examples/agent/code_act_agent.ipynb at run-llama/llama_index 847acaa): SimpleCodeExecutor
copied verbatim, code_execute_fn=code_executor.execute, tools passed both to the executor's
locals and to CodeActAgent. A scripted fake LLM replaces OpenAI: each run replies once with
<execute>code</execute>, then with plain text so the agent finishes. The text that comes back is
ToolCallResult.tool_output.content, which handle_tool_call_results puts in front of the model.
"""
import time
from typing import Any, Dict, Tuple

from llama_index.core.agent.workflow import CodeActAgent, ToolCallResult
from llama_index.core.llms import CompletionResponse, CustomLLM, LLMMetadata
from llama_index.core.llms.callbacks import llm_completion_callback
from llama_index.core.workflow import Context

from probe_core import log_call

PRELUDE = ""


def call(i):
    return f"lookup({i})"


def coro(i):
    return None


def value(var):
    return f'{var}["value"]'


def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    start = time.time()
    time.sleep(0.2)
    log_call(id, start, time.time())
    return {"id": id, "value": id * 2}


# ---- verbatim from the notebook, cell 5 ----
import io
import contextlib
import ast
import traceback


class SimpleCodeExecutor:
    """
    A simple code executor that runs Python code with state persistence.

    This executor maintains a global and local state between executions,
    allowing for variables to persist across multiple code runs.

    NOTE: not safe for production use! Use with caution.
    """

    def __init__(self, locals: Dict[str, Any], globals: Dict[str, Any]):
        """
        Initialize the code executor.

        Args:
            locals: Local variables to use in the execution context
            globals: Global variables to use in the execution context
        """
        # State that persists between executions
        self.globals = globals
        self.locals = locals

    def execute(self, code: str) -> Tuple[bool, str, Any]:
        """
        Execute Python code and capture output and return values.

        Args:
            code: Python code to execute

        Returns:
            Dict with keys `success`, `output`, and `return_value`
        """
        # Capture stdout and stderr
        stdout = io.StringIO()
        stderr = io.StringIO()

        output = ""
        return_value = None
        try:
            # Execute with captured output
            with contextlib.redirect_stdout(
                stdout
            ), contextlib.redirect_stderr(stderr):
                # Try to detect if there's a return value (last expression)
                try:
                    tree = ast.parse(code)
                    last_node = tree.body[-1] if tree.body else None

                    # If the last statement is an expression, capture its value
                    if isinstance(last_node, ast.Expr):
                        # Split code to add a return value assignment
                        last_line = code.rstrip().split("\n")[-1]
                        exec_code = (
                            code[: -len(last_line)]
                            + "\n__result__ = "
                            + last_line
                        )

                        # Execute modified code
                        exec(exec_code, self.globals, self.locals)
                        return_value = self.locals.get("__result__")
                    else:
                        # Normal execution
                        exec(code, self.globals, self.locals)
                except:
                    # If parsing fails, just execute the code as is
                    exec(code, self.globals, self.locals)

            # Get output
            output = stdout.getvalue()
            if stderr.getvalue():
                output += "\n" + stderr.getvalue()

        except Exception as e:
            # Capture exception information
            output = f"Error: {type(e).__name__}: {str(e)}\n"
            output += traceback.format_exc()

        if return_value is not None:
            output += "\n\n" + str(return_value)

        return output
# ---- end verbatim ----


class ScriptedLLM(CustomLLM):
    """Stands in for OpenAI(model="gpt-4o-mini"): replies with the next queued text."""

    replies: list = []

    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(model_name="scripted")

    @llm_completion_callback()
    def complete(self, prompt: str, formatted: bool = False, **kwargs: Any) -> CompletionResponse:
        return CompletionResponse(text=self.replies.pop(0))

    @llm_completion_callback()
    def stream_complete(self, prompt: str, formatted: bool = False, **kwargs: Any):
        text = self.replies.pop(0)
        yield CompletionResponse(text=text, delta=text)


async def open_session(config):
    llm = ScriptedLLM()
    # notebook cell 6, with lookup in place of add/subtract/multiply/divide
    code_executor = SimpleCodeExecutor(
        locals={"lookup": lookup},
        globals={"__builtins__": __builtins__, "np": __import__("numpy")},
    )
    # notebook cell 8
    agent = CodeActAgent(code_execute_fn=code_executor.execute, llm=llm, tools=[lookup])
    ctx = Context(agent)
    return {"agent": agent, "ctx": ctx, "llm": llm}


async def close_session(s):
    pass


async def run(s, code):
    s["llm"].replies.extend([f"<execute>\n{code}\n</execute>", "done"])
    handler = s["agent"].run("run the probe", ctx=s["ctx"])
    outputs = []
    async for ev in handler.stream_events():
        if isinstance(ev, ToolCallResult):
            outputs.append(ev.tool_output.content)
    await handler
    out = "\n".join(outputs)
    err = out if out.startswith("Error:") else None
    return {"ok": err is None, "stdout": out, "error": err}


EXTRA_PROBES = {
    # a tool call followed by an exception: the executor's bare `except:` re-runs the whole code
    "P10b": ["r = lookup(1)\nraise ValueError('after-call')"],
    "P9b": ["from concurrent.futures import ThreadPoolExecutor\nwith ThreadPoolExecutor(5) as ex:\n    rs = list(ex.map(lookup, [1, 2, 3, 4, 5]))\nprint(sum(x['value'] for x in rs))"],
    # a function defined in one execution calling a top-level name: exec with separate
    # globals and locals dicts puts top-level names in locals, which the function cannot see
    "P8b": ["def helper():\n    return lookup(3)['value']\nprint(helper())"],
}
