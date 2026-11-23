"""Side check: if the host process dies (EXIT_MODE=sigkill: SIGKILL to its group; EXIT_MODE=os_exit: os._exit(0) in the host) while guest code spins, does the Monty worker keep running?
Parent starts a child that runs `while True: pass` via programmatic_tool_caller (default limits), SIGKILLs the
child after 4 s, then samples for orphaned `monty subprocess` workers from this venv for 75 s and kills any
it finds at the end (they are processes this script started)."""
import os, signal, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
child_code = f"""
import asyncio, os, sys
sys.path.insert(0, {HERE!r})
import adapter
agent = asyncio.run(adapter.open_session("default"))
import threading, time
if os.environ.get("EXIT_MODE") == "os_exit":
    threading.Thread(target=lambda: (time.sleep(4), os._exit(0)), daemon=True).start()
agent.tool.programmatic_tool_caller(code="while True:\\n    pass", record_direct_tool_call=False)
"""
def workers():
    ps = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,etime=,%cpu=,command="], capture_output=True, text=True).stdout
    return [l.strip() for l in ps.splitlines() if "strands-codemode/.venv/bin/monty" in l]
before = {w.split()[0] for w in workers()}
p = subprocess.Popen([PY, "-c", child_code], start_new_session=True, env={**os.environ, "OTEL_SDK_DISABLED": "true"}, stderr=subprocess.DEVNULL)
time.sleep(3)
print("before kill:", [w for w in workers() if w.split()[0] not in before], flush=True)
mode = os.environ.get("EXIT_MODE", "sigkill")
if mode == "sigkill":
    os.killpg(p.pid, signal.SIGKILL)
p.wait()
print("host exit mode:", mode, "exit code", p.returncode, flush=True)
t0 = time.time()
found = set()
while time.time() - t0 < 110:
    ws = [w for w in workers() if w.split()[0] not in before]
    found |= {w.split()[0] for w in ws}
    print(f"+{time.time() - t0:4.0f} s after host exit: {ws or 'no worker'}", flush=True)
    if not ws:
        break
    time.sleep(10)
for pid in found:
    try:
        os.kill(int(pid), signal.SIGKILL); print("cleanup: killed leftover worker", pid)
    except ProcessLookupError:
        pass
