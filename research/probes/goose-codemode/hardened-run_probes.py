"""Hardened run: each probe in its own process with GOOSE_DEFAULT_EXTENSION_TIMEOUT set, watching wall time and peak RSS."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIN = HERE.parents[2] / "research/impls/goose-codemode/target/release/goose-codemode-hardened-probe"
OUT = HERE / "out"
KILL_SECONDS = 120
KILL_RSS_KB = 4 * 1024 * 1024
TIMEOUT = os.environ.get("GOOSE_DEFAULT_EXTENSION_TIMEOUT", "10")
PROBES = sys.argv[1:] or ["P1", "P3", "P4", "P5", "P6", "P7", "P9", "P12"]


def rss_kb(pid):
    r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def run(probe):
    env = dict(os.environ, PROBE_SECRET="s3cr3t", GOOSE_DEFAULT_EXTENSION_TIMEOUT=TIMEOUT)
    start = time.monotonic()
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    stdout_path = OUT / "raw" / f"hardened-{probe}.stdout.jsonl"
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
    wall_ms = (time.monotonic() - start) * 1000
    records = [json.loads(line) for line in stdout_path.read_text().splitlines() if line.endswith("}")]
    return {"probe": probe, "pid": proc.pid, "env_GOOSE_DEFAULT_EXTENSION_TIMEOUT": TIMEOUT, "wall_ms": round(wall_ms, 1),
            "peak_rss_mb": round(peak / 1024, 1), "exit": proc.returncode, "killed": killed,
            "stderr": stderr[-4000:], "records": records}


def write(result):
    probe = result["probe"]
    (OUT / "raw" / f"hardened-{probe}.json").write_text(json.dumps(result, indent=1))
    lines = [f"probe: {probe} (hardened)", f"binary: {BIN.name}",
             f"GOOSE_DEFAULT_EXTENSION_TIMEOUT={result['env_GOOSE_DEFAULT_EXTENSION_TIMEOUT']}",
             f"process wall_ms: {result['wall_ms']}", f"peak_rss_mb: {result['peak_rss_mb']}",
             f"exit: {result['exit']}", f"killed: {result['killed']}"]
    if result["stderr"].strip():
        lines.append(f"stderr tail:\n{result['stderr']}")
    for r in result["records"]:
        if "code" not in r:
            lines += ["", json.dumps(r)]
            continue
        text = r["text"]
        lines += ["", f"--- execution {r['exec']} ---", "code:", r["code"], f"is_error: {r['is_error']}",
                  f"elapsed_ms: {r['elapsed_ms']:.2f}", f"host_calls: {r['host_calls']}",
                  "text returned to model:", text if len(text) <= 2000 else text[:2000] + "...[cut by harness]"]
    (OUT / f"hardened-{probe}.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines), "\n")


for p in PROBES:
    write(run(p))
