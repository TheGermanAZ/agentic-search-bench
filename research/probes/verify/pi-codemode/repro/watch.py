"""Run a command, sample the RSS of its whole process tree, kill it at 4 GB RSS or 120 s.

Usage: python3 -I watch.py <outfile> <command...>
Writes the command's stdout, stderr and a watch summary (wall ms, peak tree RSS, kill reason) to outfile.
"""
import json
import os
import signal
import subprocess
import sys
import time

LIMIT_KB = 4 * 1024 * 1024
LIMIT_S = 120


def tree_rss_kb(root):
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    kids, rss = {}, {}
    for line in out.splitlines():
        pid, ppid, r = (int(x) for x in line.split())
        kids.setdefault(ppid, []).append(pid)
        rss[pid] = r
    total, stack = 0, [root]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total


def main():
    outfile, cmd = sys.argv[1], sys.argv[2:]
    env = dict(os.environ, PROBE_SECRET="s3cr3t")
    t0 = time.monotonic()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
    peak, killed = 0, None
    import threading

    chunks = {"out": b"", "err": b""}

    def pump(stream, key):
        chunks[key] = stream.read()

    th = [threading.Thread(target=pump, args=(proc.stdout, "out")), threading.Thread(target=pump, args=(proc.stderr, "err"))]
    for t in th:
        t.start()
    while proc.poll() is None:
        peak = max(peak, tree_rss_kb(proc.pid))
        if peak >= LIMIT_KB:
            killed = "killed-at-4GB-rss"
        elif time.monotonic() - t0 >= LIMIT_S:
            killed = "killed-at-120s"
        if killed:
            os.killpg(proc.pid, signal.SIGKILL)
            break
        time.sleep(0.05)
    proc.wait()
    for t in th:
        t.join()
    wall = round((time.monotonic() - t0) * 1000)
    summary = {"cmd": cmd, "exit_code": proc.returncode, "wall_ms": wall, "peak_tree_rss_mb": round(peak / 1024, 1), "watch_kill": killed}
    with open(outfile, "w") as f:
        f.write(chunks["out"].decode(errors="replace"))
        if chunks["err"]:
            f.write("\n--- stderr ---\n" + chunks["err"].decode(errors="replace")[-4000:])
        f.write("\n--- watch ---\n" + json.dumps(summary) + "\n")
    print(json.dumps(summary))


main()
