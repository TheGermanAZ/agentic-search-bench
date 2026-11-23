"""RUBRIC hardened run for smolagents LocalPythonExecutor (smolagents 1.26.0).

Hardened config: LocalPythonExecutor(additional_authorized_imports=[], timeout_seconds=5); HARDENED_TIMEOUT_S=1 reproduces out/extra-timeout1-*.
timeout_seconds is the only stricter public knob (local_python_executor.py:1704-1713 at v1.26.0);
there is no memory or network option, and imports are already the base allowlist.

Usage, one probe per process (P7 through the shared memory lock):
    PY=../../impls/smolagents-local/.venv/bin/python
    for p in P3 P4 P5 P6 P9 P12; do PROBE_SECRET=s3cr3t $PY hardened.py $p; done
    PROBE_SECRET=s3cr3t ../mem-lock.sh $PY hardened.py P7
Writes out/hardened-<P>.txt and out/hardened-<P>.json.
"""

import os
import sys

import harness as h
from smolagents import LocalPythonExecutor

TIMEOUT_S = int(os.environ.get("HARDENED_TIMEOUT_S", "5"))
_write = h.write


def make_executor():
    ex = LocalPythonExecutor(additional_authorized_imports=[], timeout_seconds=TIMEOUT_S)
    ex.send_tools({"lookup": h.Lookup()})
    return ex


def write(pid, raw, summary):
    summary["config"] = f"LocalPythonExecutor(additional_authorized_imports=[], timeout_seconds={TIMEOUT_S})"
    _write(f"hardened-{pid}", f"config: {summary['config']}\n" + raw, summary)


h.make_executor = make_executor
h.write = write

if __name__ == "__main__":
    for pid in sys.argv[1:]:
        raw, summary = h.PROBES[pid]()
        write(pid, raw, summary)
        print(summary, flush=True)
