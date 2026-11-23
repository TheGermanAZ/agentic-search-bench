"""DSPy RLM adapter: dspy 3.5.0, `dspy.RLM("question -> answer", tools=[lookup])` with the default
interpreter_factory=PythonInterpreter (Pyodide 0.29.4 on Deno 2.x).

The LLM is replaced by dspy.utils.DummyLM, which returns a scripted {plan, code} action per iteration:
iteration 1 runs the probe code, the last iteration calls SUBMIT. Each probe execution is one full
rlm(question=...) forward call, so it gets a fresh interpreter, as RLM does per forward. What the model
would see is read from the next LM request: the chat message that follows the assistant turn holding the
probe code (that message is REPL output after RLM's own max_output_chars truncation).

A code string containing the line "#--NEXT--" is split into several iterations of the same forward.
"""

import asyncio
import os
import time
from pathlib import Path

IMPL = Path(__file__).resolve().parents[2] / "impls" / "dspy-rlm"
# Keep DSPy's sandbox cache and Deno's npm cache inside this repo, not in $HOME.
os.environ.setdefault("DSPY_CACHEDIR", str(IMPL / "cache"))
os.environ.setdefault("DENO_DIR", str(IMPL / "deno-cache"))

import dspy  # noqa: E402
from dspy.utils import DummyLM  # noqa: E402

from probe_core import log_call  # noqa: E402

PRELUDE = ""
SPLIT = "\n#--NEXT--\n"


def call(i):
    return f"lookup(id={i})"


def coro(i):
    return None  # tools are synchronous inside the sandbox (pyodide.ffi.run_sync), so P9 is a plain loop


def value(var):
    return f'{var}["value"]'


def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    start = time.time()
    time.sleep(0.2)
    log_call(id, start, time.time())
    return {"id": id, "value": id * 2}


async def open_session(config):
    return {"config": config}


async def close_session(sess):
    pass


def _forward(code):
    codes = code.split(SPLIT)
    answers = [{"plan": f"step {i}", "code": c} for i, c in enumerate(codes)]
    answers.append({"plan": "finish", "code": "SUBMIT(answer='done')"})
    lm = DummyLM(answers)
    rlm = dspy.RLM("question -> answer", tools=[lookup], max_iters=len(answers))
    with dspy.context(lm=lm):
        pred = rlm(question="q")
    # What the model saw after each probe iteration: the message after the assistant turn with that code.
    seen = []
    for i in range(len(codes)):
        msgs = lm.history[i + 1]["messages"]
        idx = [k for k, m in enumerate(msgs) if m.get("role") == "assistant"][i]
        seen.append(str(msgs[idx + 1]["content"]))
    return pred, seen


async def run(sess, code):
    pred, seen = await asyncio.to_thread(_forward, code)
    traj = pred.trajectory
    raw_out = [t.get("output") for t in traj]
    last = seen[-1]
    err = last if "[Error]" in last else None
    out = {"ok": err is None, "stdout": "" if err else last, "model_view_all": seen,
           "raw_outputs_untruncated_len": [len(o or "") for o in raw_out], "answer": getattr(pred, "answer", None)}
    if err:
        out["error"] = err
    return out


EXTRA_PROBES = {
    # P8 within one forward: two iterations share one interpreter.
    "P8within": ["kept = 7" + SPLIT + "try:\n    msg = kept\nexcept NameError:\n    msg = \"gone\"\nprint(msg)"],
    # Pyodide's `js` module reaches the Deno global scope: try Deno's own file, env, process and network APIs.
    "P12js": [
        "import js\nprint('JSREAD ' + str(js.Deno.readTextFileSync('/etc/hosts'))[:60])",
        "import js\nprint('JSENV ' + str(js.Deno.env.get('PROBE_SECRET')))",
        "import js\nfrom pyodide.ffi import to_js\ncmd = js.Deno.Command.new('echo', to_js({'args': ['PWNED']}))\nprint('JSRUN ' + str(cmd.outputSync().code))",
        "import js\nfrom pyodide.ffi import run_sync\nr = run_sync(js.fetch('https://example.com'))\nprint('JSFETCH ' + str(r.status))",
        "import js\nprint('JSPERM ' + str(js.Deno.permissions.querySync(js.Object.fromEntries([['name', 'read'], ['path', '/etc/hosts']])).state))",
    ],
    # Output both printed and returned: which one comes back when both exist?
    "P2both": ['print("PRINTED")\n"RETURNED"'],
    # Output above the 10,000-char RLM cap, printed only.
    "Pcap": ['print("B" * 30000)'],
}

def _guarded(label, body):
    lines = "\n".join("    " + l for l in body.splitlines())
    return f"try:\n{lines}\nexcept BaseException as e:\n    print('{label} caught', type(e).__name__, str(e)[:300])"


# The same attempts wrapped in try/except, so a caught exception prints its text instead of ending the sandbox.
EXTRA_PROBES["P12jsTry"] = [_guarded(f"A{i}", c) for i, c in enumerate(EXTRA_PROBES["P12js"][:4])]
EXTRA_PROBES["P3try"] = [_guarded("URLLIB", 'import urllib.request\nr = urllib.request.urlopen("https://example.com", timeout=10)\nprint("HTTP", r.status)'),
                         _guarded("PYFETCH", 'from pyodide.http import pyfetch\nr = await pyfetch("https://example.com")\nprint("HTTP", r.status)')]
# After a MemoryError, does the same interpreter (same forward) still run code?
EXTRA_PROBES["P7next"] = ['a = []\ntry:\n    while True:\n        a.append("x" * 10**6)\nexcept MemoryError:\n    n = len(a)\n    a = None\n    print("caught MemoryError after", n, "MB")' + SPLIT + 'print("next iteration", 1 + 1)']
