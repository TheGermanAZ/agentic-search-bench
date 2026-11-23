"""Run the SPEC probes as shell and python3 commands under `codex sandbox` (Seatbelt), no model."""
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CODEX = Path(os.environ.get(
    "CODEX_BIN",
    Path.home() / ".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"))
CODEX_HOME = REPO / "research/impls/codex-sandbox/codex-home"
WORK = HERE / "work"
OUT = HERE / "out"
KILL_SECONDS = 120
KILL_RSS_KB = 4 * 1024 * 1024
MODES = {
    "read-only": [],
    "workspace-write": ["-c", 'sandbox_mode="workspace-write"'],
}
ESCAPE_TARGET = OUT / "P12-escape-write.txt"

PY_SUBCLASSES = (
    "names=[c.__name__ for c in ().__class__.__base__.__subclasses__()];"
    "print('_wrap_close' in names, 'Popen' in names);"
    "w=[c for c in ().__class__.__base__.__subclasses__() if c.__name__=='_wrap_close'][0];"
    "print('via _wrap_close:', w.__init__.__globals__['system']('echo PWNED-subclasses'))"
)
PROBES = {
    "P2": [("python print 200000 chars then bare expression",
            ["python3", "-c", 'print("A"*200000)\n"RETURNED"'])],
    "P3": [("python urllib", ["python3", "-c",
                              'import urllib.request;print(urllib.request.urlopen("https://example.com", timeout=10).status)']),
           ("curl", ["/usr/bin/curl", "-sS", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "https://example.com"])],
    "P4": [("python open", ["python3", "-c", 'print(open("/etc/hosts").read()[:200])']),
           ("head -c 200", ["/usr/bin/head", "-c", "200", "/etc/hosts"])],
    "P5": [("python os.environ", ["python3", "-c", 'import os;print(os.environ.get("PROBE_SECRET"))']),
           ("sh echo", ["/bin/sh", "-c", 'echo "$PROBE_SECRET"'])],
    "P6": [("python busy loop", ["python3", "-c", "while True: pass"])],
    "P7": [("python allocate 1e6-char strings", ["python3", "-c", 'a=[]\nwhile True: a.append("x"*10**6)'])],
    "P10": [("python raise", ["python3", "-c", 'raise ValueError("probe-boom")'])],
    "P11": [("python print(2)", ["python3", "-c", "print(2)"])] * 21,
    "P12": [("python subclasses walk", ["python3", "-c", PY_SUBCLASSES]),
            ("python os.system", ["python3", "-c", '__import__("os").system("echo PWNED")']),
            ("os.system write outside workspace",
             ["python3", "-c", f'import os;print("exit", os.system("echo PWNED > {ESCAPE_TARGET}"))'])],
}
MODE_PROBES = {"P6": ["read-only"], "P7": ["read-only"], "P11": ["read-only"]}


def tree_rss_kb(root):
    rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    procs = [tuple(int(x) for x in row.split()) for row in rows.splitlines() if row.strip()]
    pids, total, grew = {root}, 0, True
    while grew:
        grew = False
        for pid, ppid, _ in procs:
            if ppid in pids and pid not in pids:
                pids.add(pid)
                grew = True
    return sum(rss for pid, _, rss in procs if pid in pids)


def run(mode, argv):
    cmd = [str(CODEX), "sandbox", *MODES[mode], "--", *argv]
    env = dict(os.environ, CODEX_HOME=str(CODEX_HOME), PROBE_SECRET="s3cr3t")
    start = time.monotonic()
    out_path, err_path = OUT / "raw" / "stdout.tmp", OUT / "raw" / "stderr.tmp"
    with open(out_path, "wb") as so, open(err_path, "wb") as se:
        proc = subprocess.Popen(cmd, cwd=WORK, env=env, stdout=so, stderr=se, start_new_session=True)
        peak, killed = 0, None
        while proc.poll() is None:
            peak = max(peak, tree_rss_kb(proc.pid))
            elapsed = time.monotonic() - start
            if peak >= KILL_RSS_KB:
                killed = f"killed by harness at {peak / 1024:.0f} MB tree RSS after {elapsed:.1f}s"
            elif elapsed >= KILL_SECONDS:
                killed = f"killed by harness at {KILL_SECONDS}s (no-limit-within-120s)"
            if killed:
                os.killpg(proc.pid, 9)
                proc.wait()
                break
            time.sleep(0.02)
    wall_ms = (time.monotonic() - start) * 1000
    stdout = out_path.read_bytes().decode(errors="replace")
    stderr = err_path.read_bytes().decode(errors="replace")
    return {"mode": mode, "argv": argv, "exit": proc.returncode, "wall_ms": round(wall_ms, 1),
            "peak_tree_rss_mb": round(peak / 1024, 1), "killed": killed,
            "stdout_len": len(stdout), "stdout": stdout, "stderr": stderr}


def clip(text):
    return text if len(text) <= 1500 else f"{text[:300]}\n...[{len(text) - 600} chars elided by harness]...\n{text[-300:]}"


def main(selected):
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=True)
    for probe in selected:
        records = []
        for mode in MODE_PROBES.get(probe, list(MODES)):
            for label, argv in PROBES[probe]:
                ESCAPE_TARGET.unlink(missing_ok=True)
                r = run(mode, argv)
                r["label"] = label
                if "write outside workspace" in label:
                    r["escape_file_exists_after"] = ESCAPE_TARGET.exists()
                    ESCAPE_TARGET.unlink(missing_ok=True)
                if probe == "P2":
                    r["count_A_in_stdout"] = r["stdout"].count("A")
                    r["RETURNED_in_stdout"] = "RETURNED" in r["stdout"]
                records.append(r)
        (OUT / "raw" / f"{probe}.json").write_text(json.dumps(records, indent=1))
        lines = [f"probe: {probe}", f"codex: {CODEX} (codex-cli 0.169.0)", f"CODEX_HOME: {CODEX_HOME} (empty, no user config)"]
        for r in records:
            lines += ["", f"--- [{r['mode']}] {r['label']} ---", f"argv: {json.dumps(r['argv'])}",
                      f"exit: {r['exit']}  wall_ms: {r['wall_ms']}  peak_tree_rss_mb: {r['peak_tree_rss_mb']}  killed: {r['killed']}",
                      f"stdout chars: {r['stdout_len']}"]
            for key in ("count_A_in_stdout", "RETURNED_in_stdout", "escape_file_exists_after"):
                if key in r:
                    lines.append(f"{key}: {r[key]}")
            lines += ["stdout:", clip(r["stdout"]), "stderr:", clip(r["stderr"])]
        if probe == "P11":
            times = [r["wall_ms"] for r in records]
            warm = sorted(times[1:])
            lines += ["", f"first invocation ms: {times[0]}",
                      f"20 later invocations median ms: {statistics.median(warm)}",
                      f"20 later invocations p90 ms: {warm[int(0.9 * len(warm)) - 1]}"]
        (OUT / f"{probe}.txt").write_text("\n".join(lines) + "\n")
        print(f"{probe}: " + "; ".join(f"[{r['mode']}] {r['label']}: exit={r['exit']} {r['killed'] or ''}" for r in records[:6]))


main(sys.argv[1:] or ["P2", "P3", "P4", "P5", "P6", "P7", "P10", "P11", "P12"])
