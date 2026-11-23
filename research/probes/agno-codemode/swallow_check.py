"""Side check: after the hardened 10 s timeout returns on a cell that swallows KeyboardInterrupt, is the
kernel still spinning? Samples the kernel's CPU with ps for 20 s, tries a second cell, then shuts down."""
import asyncio, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

def kernels():
    me = str(os.getpid())
    ps = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,%cpu=,command="], capture_output=True, text=True).stdout
    return [l.strip()[:140] for l in ps.splitlines() if l.split()[1] == me and "ipykernel" in l]

async def main():
    sess = await adapter.open_session("hardened")
    t = time.time()
    r = await adapter.run(sess, adapter.EXTRA_PROBES["P6swallow"][0])
    print(f"first cell returned after {time.time() - t:.1f} s: {r['stdout'][-200:]!r}", flush=True)
    for i in range(4):
        print(f"  +{time.time() - t:.0f} s kernel processes:", kernels(), flush=True)
        await asyncio.sleep(5)
    t2 = time.time()
    try:
        r2 = await asyncio.wait_for(adapter.run(sess, adapter.EXTRA_PROBES["P6swallow"][1]), 60)
    except BaseException as e:  # noqa: BLE001
        r2 = {"stdout": f"raised {type(e).__name__}: {e}"}
    print(f"second cell after {time.time() - t2:.1f} s: {r2['stdout'][-300:]!r}", flush=True)
    print("  kernel processes:", kernels(), flush=True)
    await adapter.close_session(sess)
    print("  after close:", kernels(), flush=True)

asyncio.run(main())
sys.stdout.flush()
os._exit(0)
