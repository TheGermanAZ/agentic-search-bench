"""Side check: which process runs the guest code, and does the session survive a MemoryError?
Runs `while True: pass` through programmatic_tool_caller in a thread and lists this process's children
with ps while it spins; then runs the P7 memory loop followed by print(2)."""
import asyncio, os, subprocess, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter

agent = asyncio.run(adapter.open_session("default"))
res = {}
t = threading.Thread(target=lambda: res.setdefault("loop", agent.tool.programmatic_tool_caller(code="while True:\n    pass", record_direct_tool_call=False)), daemon=True)
t.start()
time.sleep(3)
me = os.getpid()
ps = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,%cpu=,rss=,command="], capture_output=True, text=True).stdout
print(f"harness pid {me}; children while the loop spins:")
kids = [l for l in ps.splitlines() if l.split()[1] == str(me)]
for l in kids:
    print("  ", l.strip()[:200])
grand = [l for l in ps.splitlines() if l.split()[1] in {k.split()[0] for k in kids}]
for l in grand:
    print("   grandchild", l.strip()[:200])
print("P7 then next run in the same agent:")
r = agent.tool.programmatic_tool_caller(code='a = []\nwhile True:\n    a.append("x" * 10**6)', record_direct_tool_call=False)
print("  P7 ->", r["status"], r["content"][0]["text"][-160:].replace("\n", " "))
r = agent.tool.programmatic_tool_caller(code="print(1 + 1)", record_direct_tool_call=False)
print("  next ->", r["status"], r["content"][0]["text"])
sys.stdout.flush()
os._exit(0)
