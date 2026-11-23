"""Run each goose code-mode probe in its own process, watching wall time and peak RSS."""
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIN = HERE.parents[2] / "research/impls/goose-codemode/target/release/goose-codemode-probe"
OUT = HERE / "out"
KILL_SECONDS = 120
KILL_RSS_KB = 4 * 1024 * 1024
PROBES = sys.argv[1:] or [f"P{i}" for i in range(1, 13)] + ["P2b", "P6b", "P7b", "P7c"]


def rss_kb(pid):
    r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def run(probe):
    env = dict(os.environ, PROBE_SECRET="s3cr3t")
    start = time.monotonic()
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    stdout_path = OUT / "raw" / f"{probe}.stdout.jsonl"
    with open(stdout_path, "w") as sink:
        proc = subprocess.Popen([str(BIN), probe], stdout=sink, stderr=subprocess.PIPE, env=env, text=True)
    peak, killed = 0, None
    while proc.poll() is None:
        peak = max(peak, rss_kb(proc.pid))
        elapsed = time.monotonic() - start
        if peak >= KILL_RSS_KB:
            killed = f"killed by harness at {peak / 1024:.0f} MB RSS after {elapsed:.1f}s"
        elif elapsed >= KILL_SECONDS:
            killed = f"killed by harness at {KILL_SECONDS}s (no-limit-within-120s)"
        if killed:
            proc.kill()
            break
        time.sleep(0.05)
    _, stderr = proc.communicate()
    stdout = stdout_path.read_text()
    wall_ms = (time.monotonic() - start) * 1000
    records = [json.loads(line) for line in stdout.splitlines() if line.endswith("}")]
    return {"probe": probe, "wall_ms": round(wall_ms, 1), "peak_rss_mb": round(peak / 1024, 1),
            "exit": proc.returncode, "killed": killed, "stderr": stderr[-4000:], "records": records}


def summarize_text(text):
    if len(text) <= 2000:
        return text
    return f"{text[:300]}\n...[{len(text) - 600} chars elided by harness]...\n{text[-300:]}"


def write(result):
    probe = result["probe"]
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    (OUT / "raw" / f"{probe}.json").write_text(json.dumps(result, indent=1))
    lines = [f"probe: {probe}", f"binary: {BIN.name}", f"process wall_ms: {result['wall_ms']}",
             f"peak_rss_mb: {result['peak_rss_mb']}", f"exit: {result['exit']}",
             f"killed: {result['killed']}"]
    if result["stderr"].strip():
        lines.append(f"stderr tail:\n{result['stderr']}")
    for r in result["records"]:
        text = r["text"]
        lines += ["", f"--- execution {r['exec']} ---", "code:", r["code"],
                  f"is_error: {r['is_error']}", f"elapsed_ms: {r['elapsed_ms']:.2f}",
                  f"host_calls: {r['host_calls']}", f"returned chars: {len(text)}"]
        if probe in ("P2", "P2b"):
            lines += [f"count of 'A' chars returned: {text.count('A')}",
                      f"contains RETURNED: {'RETURNED' in text}"]
        lines += ["text returned to model:", summarize_text(text)]
    if probe == "P11":
        times = [r["elapsed_ms"] for r in result["records"]]
        warm = sorted(times[1:])
        lines += ["", f"first execution in process (cold) ms: {times[0]:.2f}",
                  f"20 later executions median ms: {statistics.median(warm):.2f}",
                  f"20 later executions p90 ms: {warm[int(0.9 * len(warm)) - 1]:.2f}"]
    (OUT / f"{probe}.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:8]), "\n")


for p in PROBES:
    write(run(p))
