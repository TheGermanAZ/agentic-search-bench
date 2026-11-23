"""Extra: which OS processes run sandbox code? Starts an infinite loop through execute and lists
the child processes of this Python process while it runs. Writes out/worker-processes.txt."""
import asyncio
import os
import subprocess
from pathlib import Path

from adapter import open_session, run


async def main():
    s = await open_session("hardened")
    task = asyncio.create_task(run(s, "while True:\n    pass"))
    await asyncio.sleep(2)
    rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss=,command="], capture_output=True, text=True).stdout.splitlines()
    ps = "PID PPID RSS_KB COMMAND (children of the harness)\n" + "\n".join(r for r in rows if r.split()[1] == str(os.getpid()) and "ps -A" not in r)
    me = f"harness pid {os.getpid()}\n"
    res = await task
    out = me + ps + f"\nexecute result after loop: {res}\n"
    Path("out/worker-processes.txt").write_text(out)
    print(out)


asyncio.run(main())
