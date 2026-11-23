"""Side check: after the hardened wall-clock `timeout` fires, does the Monty worker stop?
Runs `while True: pass` under make_programmatic_tool_caller(timeout=10) and samples this process's
descendant processes (pid, pgid, %cpu) every few seconds for 80 s after the tool returns."""
import asyncio, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

def snap(tag):
    ps = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,pgid=,%cpu=,command="], capture_output=True, text=True).stdout
    rows = [l.split(None, 4) for l in ps.splitlines()]
    mine = {str(os.getpid())}
    out = []
    changed = True
    while changed:
        changed = False
        for r in rows:
            if r[1] in mine and r[0] not in mine:
                mine.add(r[0]); changed = True
    for r in rows:
        if (r[0] in mine and r[0] != str(os.getpid()) and "monty" in r[4]) or ("strands-codemode/.venv/bin/monty" in r[4] and r[1] == "1"):
            out.append(f"pid {r[0]} ppid {r[1]} pgid {r[2]} cpu {r[3]}% {r[4][-30:]}")
    print(f"[{tag}] harness pid {os.getpid()} pgid {os.getpgid(0)}; monty descendants or orphans of this venv: {out or 'none'}", flush=True)

agent = asyncio.run(adapter.open_session("hardened"))
t0 = time.time()
r = agent.tool.programmatic_tool_caller(code="while True:\n    pass", record_direct_tool_call=False)
print(f"tool returned after {time.time() - t0:.1f} s: {r['content'][0]['text']}", flush=True)
for i in range(9):
    snap(f"+{time.time() - t0:.0f} s")
    time.sleep(9)
r = agent.tool.programmatic_tool_caller(code="print(1 + 1)", record_direct_tool_call=False)
print("next run ->", r["status"], r["content"][0]["text"], flush=True)
snap("end")
os._exit(0)
