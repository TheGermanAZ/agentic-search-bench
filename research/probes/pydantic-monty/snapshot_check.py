"""Snapshot round trip: pause at an external call, dump bytes, restore in a NEW pool and session, resume."""
import os, sys
from pydantic_monty import Monty, FunctionSnapshot, MontyComplete
lines = []
def log(*a):
    s = " ".join(str(x) for x in a); print(s, flush=True); lines.append(s)
code = "r = lookup(id=21)\nprint('after host call', r['value'])\nr['value'] + 1"
with Monty() as pool1:
    with pool1.checkout() as s1:
        snap = s1.feed_start(code)
        log("SNAP1 type", type(snap).__name__, "function", getattr(snap, "function_name", None), "args", getattr(snap, "args", None))
        blob = snap.dump()
        log("SNAP1 dump bytes", len(blob))
with Monty() as pool2:
    with pool2.checkout() as s2:
        restored = s2.load_snapshot(blob, external_lookup={"lookup": None} if False else None)
        log("SNAP2 restored type", type(restored).__name__, "function", getattr(restored, "function_name", None))
        done = restored.resume({"return_value": {"id": 21, "value": 42}})
        log("SNAP2 resumed ->", type(done).__name__, getattr(done, "value", None) if isinstance(done, MontyComplete) else "")
        log("SNAP2 output value", getattr(done, "output", None))
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "snapshot.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
