"""Side check: does the default CodeMode timeout (300 s, code_mode.py:248) stop `while True: pass`?
The SPEC harness stops at 120 s, so this runs outside it with its own 360 s cap, then runs print(2)
in the same session to see whether the session survives."""
import asyncio, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

async def main():
    sess = await adapter.open_session("default")
    await adapter.run(sess, "1 + 1")  # start the kernel first
    t = time.time()
    try:
        r = await asyncio.wait_for(adapter.run(sess, "while True:\n    pass"), 360)
    except BaseException as e:  # noqa: BLE001
        r = {"raised": f"{type(e).__name__}: {e}"}
    print(f"stopped after {time.time() - t:.1f} s: {r}", flush=True)
    try:
        r2 = await asyncio.wait_for(adapter.run(sess, "print(1 + 1)"), 120)
    except BaseException as e:  # noqa: BLE001
        r2 = {"raised": f"{type(e).__name__}: {e}"}
    print("next cell:", r2, flush=True)
    await adapter.close_session(sess)

asyncio.run(main())
sys.stdout.flush()
os._exit(0)
