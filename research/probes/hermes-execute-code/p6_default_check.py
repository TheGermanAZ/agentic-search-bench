"""Side check: does the default code_execution.timeout (300 s, code_execution_tool.py:45) stop `while True: pass`
on the local backend? The SPEC harness stops at 120 s, so this runs outside it with its own 360 s cap, then runs
print(2) in the same session."""
import asyncio, os, sys, time
sys.argv = [sys.argv[0], "child", "default"]  # adapter reads the config name from argv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

async def main():
    sess = await adapter.open_session("default")
    await adapter.run(sess, "1 + 1")
    t = time.time()
    try:
        r = await asyncio.wait_for(adapter.run(sess, "while True:\n    pass"), 360)
    except BaseException as e:  # noqa: BLE001
        r = {"raised": f"{type(e).__name__}: {e}"}
    print(f"stopped after {time.time() - t:.1f} s: {r.get('model_sees', r)}", flush=True)
    r2 = await adapter.run(sess, "print(1 + 1)")
    print("next cell:", r2.get("model_sees"), flush=True)
    await adapter.close_session(sess)

asyncio.run(main())
sys.stdout.flush()
os._exit(0)
