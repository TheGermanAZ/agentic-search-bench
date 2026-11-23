"""Does LocalCommandLineCodeExecutor's timeout hold when the guest starts a child that keeps stdout open?
Uses the hardened 10 s timeout. The guest starts `sleep 37`, then loops forever."""
import time

import psutil

import adapter as A

s = A.new_session(True)
t0 = time.perf_counter()
r = s.run('import subprocess\nsubprocess.Popen(["sleep", "37"])\nwhile True:\n    pass')
el = time.perf_counter() - t0
print(f"execution returned after {el:.1f} s with timeout=10: ok={r['ok']} error={r['error']!r}")
left = [p for p in psutil.process_iter(["pid", "ppid", "cmdline"]) if p.info["cmdline"] == ["sleep", "37"]]
print("surviving 'sleep 37' processes when execute_code_blocks returned:", [(p.info["pid"], p.info["ppid"]) for p in left])
for p in left:
    p.kill()
s.close()
