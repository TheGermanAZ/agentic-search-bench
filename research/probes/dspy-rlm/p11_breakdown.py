"""Side check for P11: cost of one RLM forward (fresh Deno + Pyodide each time) versus the cost of one more
REPL iteration inside a warm forward. Runs forwards with 1 and with 21 `print(2)` iterations, 5 times each."""
import os, statistics, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

def t(n):
    s = time.perf_counter()
    adapter._forward(adapter.SPLIT.join(["print(2)"] * n))
    return (time.perf_counter() - s) * 1000

one = [t(1) for _ in range(5)]
many = [t(21) for _ in range(5)]
per_iter = (statistics.median(many) - statistics.median(one)) / 20
print(f"forward with 1 iteration (+SUBMIT): median {statistics.median(one):.0f} ms {sorted(round(x) for x in one)}")
print(f"forward with 21 iterations (+SUBMIT): median {statistics.median(many):.0f} ms {sorted(round(x) for x in many)}")
print(f"marginal cost per extra iteration in a warm interpreter (incl. DummyLM + adapter work): {per_iter:.1f} ms")
