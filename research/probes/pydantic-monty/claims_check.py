"""Article claims that are not SPEC probes: architecture, article API, limits when configured, snapshots."""
import os, subprocess, time, statistics
import pydantic_monty
from pydantic_monty import Monty

lines = []
def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    lines.append(s)

# 1. Is execution in-process (article) or in a worker subprocess (v1.6 README)?
with Monty() as pool:
    with pool.checkout() as s:
        me = os.getpid()
        kids_before = subprocess.run(["pgrep", "-P", str(me)], capture_output=True, text=True).stdout.split()
        s.feed_run("x = 1")
        kids_after = subprocess.run(["pgrep", "-P", str(me)], capture_output=True, text=True).stdout.split()
        names = subprocess.run(["ps", "-o", "pid=,comm=", "-p", ",".join(kids_after)], capture_output=True, text=True).stdout if kids_after else ""
        log("ARCH host pid", me, "child pids", kids_after, "names:", names.strip().replace("\n", " ; "))
        log("ARCH host process is the interpreter running feed_run:", "no" if kids_after else "yes")

# 2. Article hello-world API (0.0.7-era) on v1.6
try:
    Monty("print(f'{get_greeting(tone=\"friendly\")} {place}')", inputs=["place"], external_functions=["get_greeting"], type_check=True, type_check_stubs="def get_greeting(tone: str) -> str: ...\nplace: str\n")
    log("ARTICLE API constructor accepted")
except Exception as e:
    log("ARTICLE API Monty(code, inputs=, external_functions=) ->", type(e).__name__, str(e)[:200])

# 3. Latency: article says 0.004 ms; measure current API, warm and fresh
def timeit(fn, n=200):
    xs = []
    for _ in range(n):
        t = time.perf_counter(); fn(); xs.append((time.perf_counter() - t) * 1000)
    xs.sort()
    return statistics.median(xs), xs[int(0.9 * (len(xs) - 1))]
with Monty() as pool:
    with pool.checkout() as s:
        m, p = timeit(lambda: s.feed_run("1 + 1", print_callback=lambda *a: None))
        log(f"LATENCY warm feed '1+1' n=200 median {m*1000:.1f} us p90 {p*1000:.1f} us")
        m2, p2 = timeit(lambda: s.feed_run("def f(x):\n    return x * 2\nf(21)", print_callback=lambda *a: None), 50)
        log(f"LATENCY warm feed with def n=50 median {m2*1000:.1f} us p90 {p2*1000:.1f} us")
    m3, p3 = timeit(lambda: pool.checkout().__enter__().feed_run("1 + 1", print_callback=lambda *a: None) if False else None, 1)

# 4. Limits when configured vs default
with Monty() as pool:
    try:
        with pool.checkout(limits={"max_feed_duration_secs": 0.5}) as s:
            t = time.perf_counter()
            s.feed_run("while True:\n    pass")
    except Exception as e:
        log("LIMIT max_feed_duration_secs=0.5 ->", type(e).__name__, str(e)[:160], f"after {time.perf_counter()-t:.2f} s")
    try:
        with pool.checkout(limits={"max_memory": 50_000_000}) as s:
            s.feed_run('a = []\nwhile True:\n    a.append("x" * 10**6)')
    except Exception as e:
        log("LIMIT max_memory=50MB ->", type(e).__name__, str(e)[:160])
    try:
        with pool.checkout(limits={"max_recursion_depth": 50}) as s:
            s.feed_run("def r(n):\n    return r(n+1)\nr(0)")
    except Exception as e:
        log("LIMIT default-style recursion via max_recursion_depth=50 ->", type(e).__name__, str(e)[:160])

# 5. Snapshot: pause on an external function, dump, load in a new session, resume
from pydantic_monty import FunctionSnapshot
with Monty() as pool:
    with pool.checkout() as s:
        snap = s.feed_start("r = lookup(id=21)\nr['value'] + 1", external_lookup=None) if False else None
    try:
        with pool.checkout(limits=None) as s:
            res = s.feed_start("r = lookup(id=21)\nr['value'] + 1")
            log("SNAPSHOT first feed_start returned", type(res).__name__)
            if isinstance(res, FunctionSnapshot):
                blob = res.dump()
                log("SNAPSHOT dump size bytes", len(blob))
                os.write(1, b"")
    except Exception as e:
        log("SNAPSHOT feed_start/dump error", type(e).__name__, str(e)[:200])
    print("\n".join(lines)) if False else None

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "claims.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
