# Does starlark-pyo3's eval release the GIL? Run an endless Starlark loop in a daemon thread and
# count how often the main thread gets to run in 3 s.
import threading, time, starlark as sl
src = "def f():\n    for i in range(2147483647):\n        for j in range(2147483647):\n            pass\nf()"
def run():
    sl.eval(sl.Module(), sl.parse("c.star", src), sl.Globals.standard())
ticks = 0; t0 = time.time()
threading.Thread(target=run, daemon=True).start()
while time.time() - t0 < 3:
    time.sleep(0.01); ticks += 1
print(f"main-thread ticks in 3 s while Starlark loops: {ticks} (about 300 expected if the GIL were released); wall {time.time()-t0:.1f} s")
