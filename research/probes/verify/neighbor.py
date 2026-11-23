"""Neighbor-table rows (format of neighbor-table.txt): python3 neighbor.py <impl> ...
B delay = B's start minus (first aggressor start + 150 ms); B duration; aggressor wall time; peak host tree RSS
(and phys_footprint / gateway-container RSS where recorded)."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMES = [("R9a", "loop"), ("R9b", "mem bomb"), ("R9c", "log flood"), ("R9d", "regex"), ("R9e", "8 loops"), ("R9e4", "4 loops"), ("R9e3", "3 loops"), ("R9f", "8 recursions"), ("R9g", "12 recursions")]


def ok(t):
    if not t.get("ok"):
        return "THREW"
    r = t.get("result") or {}
    v = r.get("value", r) if isinstance(r, dict) else r
    s = json.dumps(v)
    bad = any(x in s for x in ('"failed"', '"timeout"', '"isError": true', '"status": "error"'))
    return "FAILED" if bad else "ok"


for config in ("default", "hardened"):
    print(f"\n## {config}")
    for impl in sys.argv[1:]:
        cells = []
        for tid, name in NAMES:
            f = HERE / impl / "out" / f"{config}-{tid}.json"
            if not f.exists():
                continue
            w = json.load(open(f))
            rec = w.get("record") or {}
            d = rec.get("data") or {}
            if d.get("notApplicable"):
                cells.append(f"{name}: n/a")
                continue
            kill = w.get("watchKill")
            if kill and kill["reason"] != "exit-hang-after-record(3s)":
                cells.append(f"{name}: HARNESS KILL {kill['reason']} at {kill['atMs']}ms, peak {w.get('peakTreeRssMb')}MB")
                continue
            ag, b = d["aggressors"], d["b"]
            late = b["startMs"] - (ag[0]["startMs"] + 150)
            aw = max(a.get("ms", 0) for a in ag)
            mem = f"peak {w.get('peakTreeRssMb')}MB"
            if w.get("peakTreeFootprintMb"):
                mem += f" (fp {w['peakTreeFootprintMb']}MB)"
            st = rec.get("adapterStats") or {}
            if st.get("containerPeakMb"):
                mem += f", gateway ctr {st['containerPeakMb']}MB"
            base = d["after"].get("ms")
            cells.append(f"{name}: B {late:+d}ms late, {b.get('ms')}ms {ok(b)} (after: {base}ms); aggr {aw}ms; {mem}")
        if cells:
            print(f"- {impl}: " + " | ".join(cells))
