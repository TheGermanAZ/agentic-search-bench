"""Extra for P11: how much of one execute is the per-call Monty worker pool? Times 20 runs of
(a) a new AsyncMonty pool + checkout + feed_run, as MontySandboxProvider._run_monty does per execute,
(b) feed_run on one long-lived pool and session. Writes out/P11-breakdown.txt."""
import asyncio
import statistics
import time
from pathlib import Path

import pydantic_monty


async def main():
    fresh, reused = [], []
    for _ in range(20):
        t = time.perf_counter()
        async with pydantic_monty.AsyncMonty() as pool, pool.checkout(limits={"max_feed_duration_secs": 30.0, "max_memory": 100_000_000}) as s:
            await s.feed_run("print(2)", print_callback=lambda *a: None)
        fresh.append((time.perf_counter() - t) * 1000)
    async with pydantic_monty.AsyncMonty() as pool, pool.checkout() as s:
        for _ in range(20):
            t = time.perf_counter()
            await s.feed_run("print(2)", print_callback=lambda *a: None)
            reused.append((time.perf_counter() - t) * 1000)
    out = (f"new pool per run (what CodeMode does): median {statistics.median(fresh):.1f} ms, max {max(fresh):.1f} ms\n"
           f"one pool and session reused:          median {statistics.median(reused):.2f} ms, max {max(reused):.2f} ms\n")
    Path("out/P11-breakdown.txt").write_text(out)
    print(out)


asyncio.run(main())
