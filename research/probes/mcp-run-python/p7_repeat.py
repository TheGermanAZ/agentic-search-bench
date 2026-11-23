"""Repeat P7 N times to check whether the memory outcome reproduces. Writes out/P7_repeats.txt."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_probes as rp

n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
rows = []
for i in range(n):
    res = rp.parent_run("P7")
    rows.append(f"run {i+1}: {res['outcome']} | {res['detail']}")
    print(rows[-1][:300], flush=True)
with open(os.path.join(rp.OUT, "P7_repeats.txt"), "w") as f:
    f.write("\n".join(rows) + "\n")
