"""Runs each probe in its own process, samples its RSS, kills it at 120 s or 4 GB.

Usage: run_all.py [default|hardened|both] [P1 P2 ...]
P7 runs through research/probes/mem-lock.sh.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
PY = HERE.parents[3] / "impls" / "langchain-quickjs" / ".venv" / "bin" / "python"
MEM_LOCK = HERE.parents[2] / "mem-lock.sh"
OUT = HERE / "out"
KILL_S = 120
KILL_RSS = 4 * 1024**3

DEFAULT_PROBES = [f"P{i}" for i in range(1, 13)]
HARDENED_PROBES = ["P3", "P4", "P5", "P6", "P7", "P8", "P9", "P12"]


def tree_rss(proc):
    total = 0
    for p in [proc, *proc.children(recursive=True)]:
        try:
            total += p.memory_info().rss
        except psutil.NoSuchProcess:
            pass
    return total


def run_one(config, pid):
    cmd = [str(PY), str(HERE / "harness.py"), config, pid]
    if pid == "P7":
        cmd = [str(MEM_LOCK), *cmd]
    env = {**os.environ, "PROBE_SECRET": "s3cr3t"}
    t0 = time.monotonic()
    child = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc = psutil.Process(child.pid)
    peak, killed, samples = 0, None, []
    while child.poll() is None:
        rss = tree_rss(proc)
        peak = max(peak, rss)
        samples.append((round(time.monotonic() - t0, 2), round(rss / 2**20, 1)))
        if rss > KILL_RSS:
            killed = f"killed at {rss / 2**30:.2f} GB host RSS"
        elif time.monotonic() - t0 > KILL_S:
            killed = f"killed at {KILL_S} s"
        if killed:
            for p in [*proc.children(recursive=True), proc]:
                try:
                    p.kill()
                except psutil.NoSuchProcess:
                    pass
            break
        time.sleep(0.05)
    stdout, stderr = child.communicate()
    monitor = {
        "config": config,
        "probe": pid,
        "exit_code": child.returncode,
        "wall_s": round(time.monotonic() - t0, 2),
        "peak_rss_mb": round(peak / 2**20, 1),
        "first_rss_mb": samples[0][1] if samples else None,
        "killed": killed,
        "stderr_tail": [ln for ln in stderr.strip().splitlines() if "Beta" not in ln and "CodeInterpreterMiddleware(**" not in ln][-15:],
    }
    prefix = "" if config == "default" else "hardened-"
    path = OUT / f"{prefix}{pid}.txt"
    if not path.exists() or killed or child.returncode:
        path.write_text(f"harness stdout:\n{stdout}\n")
    with path.open("a") as f:
        f.write("\nmonitor: " + json.dumps(monitor) + "\n")
        if pid == "P7":
            f.write("rss_samples_s_mb: " + json.dumps(samples[:: max(1, len(samples) // 60)]) + "\n")
    print(json.dumps(monitor))
    return monitor


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    picked = sys.argv[2:]
    plan = []
    if which in ("default", "both"):
        plan += [("default", p) for p in (picked or DEFAULT_PROBES)]
    if which in ("hardened", "both"):
        plan += [("hardened", p) for p in (picked or HARDENED_PROBES)]
    OUT.mkdir(exist_ok=True)
    for config, pid in plan:
        prefix = "" if config == "default" else "hardened-"
        (OUT / f"{prefix}{pid}.txt").unlink(missing_ok=True)
        run_one(config, pid)


if __name__ == "__main__":
    main()
