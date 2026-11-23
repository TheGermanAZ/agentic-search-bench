# Control for gil-check.py: same harness, but the busy thread is pure Python (which yields the GIL every 5 ms).
import threading, time
def run():
    while True: pass
ticks = 0; t0 = time.time()
threading.Thread(target=run, daemon=True).start()
while time.time() - t0 < 3:
    time.sleep(0.01); ticks += 1
print(f"control (pure-Python busy thread): main-thread ticks in 3 s: {ticks}; wall {time.time()-t0:.1f} s")
