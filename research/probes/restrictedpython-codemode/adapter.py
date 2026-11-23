"""RestrictedPython code mode (imran31415/codemode_python_benchmark @ 363507e).

Runs code through sandbox.executor.CodeExecutor(tools).execute(code), the exact call
CodeModeAgent.run makes (agents/codemode_agent.py:187). The project exposes no options:
CodeExecutor takes only the tools dict, so there is no hardened configuration.
The executor discards print() output (SafePrinter at executor.py:179-199 is never read)
and returns only the variable named `result`, so probes that need a value also set it.
"""
import sys
import time
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "impls/restrictedpython-codemode/src"
sys.path.insert(0, str(SRC))
from sandbox.executor import CodeExecutor  # noqa: E402

IMPL = "restrictedpython-codemode"
_calls = {"n": 0}


def lookup(id):
    _calls["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


class Session:
    def __init__(self):
        self.ex = CodeExecutor({"lookup": lookup})

    def run(self, code):
        r = self.ex.execute(code)
        return {"ok": r["success"], "stdout": "", "result": r.get("result"), "error": r.get("error"), "raw": r}

    def close(self):
        pass


def new_session(hardened):
    if hardened:
        raise RuntimeError("no hardened configuration exists")
    return Session()


def lookup_call(id_expr):
    return f"tools.lookup(id={id_expr})"


prelude = ""
host_calls = lambda: _calls["n"]  # noqa: E731
extra_rss = lambda: 0  # noqa: E731
kill_all = lambda: None  # noqa: E731

CODES = {
    "P1": "r = tools.lookup(id=21)\nprint(r['value'])\nresult = r['value']",
    "P4": 'import io\nresult = io.open("/etc/hosts").read()',
    "P5": 'import os\nresult = "ENV=" + str(os.environ.get("PROBE_SECRET"))',
    "P3": 'import urllib.request\nr = urllib.request.urlopen("https://example.com", timeout=20)\nresult = "STATUS " + str(r.status)',
    "P8b": "result = kept",
    "P9": "import time\nt = time.time()\nrs = [tools.lookup(id=i) for i in [1, 2, 3, 4, 5]]\nresult = int((time.time() - t) * 1000)",
    "P12c": None,  # filled below
}
from core import PWN_MARK  # noqa: E402
CODES["P12c"] = f'import os\nresult = os.system("echo PWNED-c; echo PWNED-c >> {PWN_MARK}")'

EXTRAS = {
    "P2-result-var": ('print("A" * 200000)\nresult = "RETURNED"', "the project convention: the agent reads only `result`"),
    "P10-io-ValueError": ('import io\nx = 1\nraise io.UnsupportedOperation("probe-boom")', "ValueError is missing from the sandbox builtins; io.UnsupportedOperation subclasses ValueError"),
    "P10-zero-division": ("x = 1\ny = x / 0", "a runtime error the guest can raise without names"),
    "P4-open-only": ('result = open("/etc/hosts").read()', "SPEC form alone"),
    "P9-threads": ("import time\nfrom concurrent.futures import ThreadPoolExecutor\nt = time.time()\nwith ThreadPoolExecutor(5) as p:\n    rs = list(p.map(lambda i: tools.lookup(id=i), [1, 2, 3, 4, 5]))\nresult = int((time.time() - t) * 1000)", "parallel via threads, since import is unrestricted"),
    "P12-sys-modules": ("import sys\nresult = sorted(k for k in sys.modules if k in ('os', 'subprocess', 'socket'))", "host module table reachable"),
    "P12-host-frames": ("import sys\nf = sys._getframe(1)\nresult = type(f).__name__", "RestrictedPython rejects _-prefixed attributes at compile time"),
    "P12-host-tools-dict": ("import gc\nresult = len(gc.get_objects()) > 0", "gc gives every live host object"),
}
