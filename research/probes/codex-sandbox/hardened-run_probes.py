"""Hardened rerun of the SPEC probes under `codex sandbox` (Seatbelt), no model.

Config is passed only with -c and -P on the `codex sandbox` command line, with CODEX_HOME pointed at
the empty research/impls/codex-sandbox/codex-home-hardened folder. Output goes to out/hardened-P*.txt.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CODEX = Path(os.environ.get(
    "CODEX_BIN",
    Path.home() / ".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"))
CODEX_HOME = REPO / "research/impls/codex-sandbox/codex-home-hardened"
WORK = HERE / "work"
OUT = HERE / "out"
KILL_SECONDS = 120
KILL_RSS_KB = 4 * 1024 * 1024
PY_KEG = Path("/opt/homebrew/Cellar/python@3.15/3.15.0_1")
PY = str(PY_KEG / "Frameworks/Python.framework/Versions/3.15/bin/python3.15")
FILESYSTEM = {":minimal": "read", ":workspace_roots": "read", str(PY_KEG): "read",
              "/etc/**": "deny", "/private/etc/**": "deny"}


def flags(filesystem):
    return [
        "-c", 'shell_environment_policy.inherit="core"',
        "-c", "shell_environment_policy.ignore_default_excludes=false",
        "-c", "permissions.hardened.filesystem={" + ",".join(f'"{k}"="{v}"' for k, v in filesystem.items()) + "}",
        "-c", "permissions.hardened.network.enabled=false",
        "-P", "hardened", "-C", str(WORK),
    ]


HARDENED = flags(FILESYSTEM)
BASE_FS = {k: v for k, v in FILESYSTEM.items() if v != "deny"}
FS_VARIANTS = {
    "no /etc deny (only :minimal, workspace, python keg readable)": BASE_FS,
    'plain path deny "/etc"="deny", "/private/etc"="deny"': {**BASE_FS, "/etc": "deny", "/private/etc": "deny"},
    'glob deny "/etc/**"="deny", "/private/etc/**"="deny" (the hardened config)': FILESYSTEM,
    'full-disk read ":root"="read" with plain path deny "/etc", "/private/etc"': {":root": "read", "/etc": "deny", "/private/etc": "deny"},
}
ESCAPE_TARGET = OUT / "hardened-P12-escape-write.txt"
OUTSIDE_WORKSPACE = REPO / "research/probes/SPEC.md"

PY_SUBCLASSES = (
    "names=[c.__name__ for c in ().__class__.__base__.__subclasses__()];"
    "print('_wrap_close' in names, 'Popen' in names);"
    "w=[c for c in ().__class__.__base__.__subclasses__() if c.__name__=='_wrap_close'][0];"
    "print('via _wrap_close:', w.__init__.__globals__['system']('echo PWNED-subclasses'))"
)
PROBES = {
    "P1": [("sanity: python runs under the hardened profile (no tool bridge exists)", [PY, "-c", "print(2)"])],
    "P3": [("python urllib", [PY, "-c",
                              'import urllib.request;print(urllib.request.urlopen("https://example.com", timeout=10).status)']),
           ("shell curl", ["/usr/bin/curl", "-sS", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "https://example.com"]),
           ("python raw socket to example.com:443 (no ssl module needed)", [PY, "-c",
            'import socket;s=socket.create_connection(("example.com", 443), timeout=10);print("connected", s.getpeername())']),
           ("shell curl with OPENSSL_CONF=/dev/null (skips the denied /etc/ssl config)",
            ["/bin/sh", "-c", 'OPENSSL_CONF=/dev/null /usr/bin/curl -sS -m 10 -o /dev/null -w "%{http_code}" https://example.com'])],
    "P4": [("python open /etc/hosts", [PY, "-c", 'print(open("/etc/hosts").read()[:200])']),
           ("shell head -c 200 /etc/hosts", ["/usr/bin/head", "-c", "200", "/etc/hosts"]),
           ("python open a repo file outside the workspace root", [PY, "-c", f'print(open("{OUTSIDE_WORKSPACE}").read()[:80])']),
           ("shell head a repo file outside the workspace root", ["/usr/bin/head", "-c", "80", str(OUTSIDE_WORKSPACE)])],
    "P5": [("python os.environ", [PY, "-c", 'import os;print(os.environ.get("PROBE_SECRET"));print(sorted(os.environ))']),
           ("shell echo", ["/bin/sh", "-c", 'echo "[$PROBE_SECRET]"; env | cut -d= -f1 | sort | tr "\\n" " "'])],
    "P6": [("python busy loop", [PY, "-c", "while True: pass"]),
           ("shell busy loop", ["/bin/sh", "-c", "while :; do :; done"])],
    "P7": [("python allocate 1e6-char strings", [PY, "-c", 'a=[]\nwhile True: a.append("x"*10**6)']),
           ("shell double a string forever", ["/bin/sh", "-c", 'a=x; while :; do a="$a$a"; done'])],
    "P9": [],
    "P12": [("python subclasses walk", [PY, "-c", PY_SUBCLASSES]),
            ("python os.system", [PY, "-c", '__import__("os").system("echo PWNED")']),
            ("python os.system write outside workspace",
             [PY, "-c", f'import os;print("exit", os.system("echo PWNED > {ESCAPE_TARGET}"))']),
            ("shell write outside workspace", ["/bin/sh", "-c", f'echo PWNED > {ESCAPE_TARGET}; echo exit=$?'])],
}


def tree_rss_kb(root):
    rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    procs = [tuple(int(x) for x in row.split()) for row in rows.splitlines() if row.strip()]
    pids, grew = {root}, True
    while grew:
        grew = False
        for pid, ppid, _ in procs:
            if ppid in pids and pid not in pids:
                pids.add(pid)
                grew = True
    return sum(rss for pid, _, rss in procs if pid in pids)


def run(argv, tag, sandbox_flags=HARDENED):
    cmd = [str(CODEX), "sandbox", *sandbox_flags, "--", *argv]
    env = dict(os.environ, CODEX_HOME=str(CODEX_HOME), PROBE_SECRET="s3cr3t")
    out_path, err_path = OUT / "raw" / f"hardened-{tag}.stdout", OUT / "raw" / f"hardened-{tag}.stderr"
    start = time.monotonic()
    with open(out_path, "wb") as so, open(err_path, "wb") as se:
        proc = subprocess.Popen(cmd, cwd=WORK, env=env, stdout=so, stderr=se, start_new_session=True)
        print(f"  spawned pid {proc.pid} (own process group) for {tag}", flush=True)
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
    out_path.unlink()
    err_path.unlink()
    return {"argv": argv, "exit": proc.returncode, "wall_ms": round(wall_ms, 1),
            "peak_tree_rss_mb": round(peak / 1024, 1), "killed": killed, "stdout": stdout, "stderr": stderr}


def clip(text):
    return text if len(text) <= 1500 else f"{text[:300]}\n...[{len(text) - 600} chars elided by harness]...\n{text[-300:]}"


def main(selected):
    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=True)
    for probe in selected:
        if probe == "P4-variants":
            lines = ["probe: P4 filesystem-deny variants (supplementary to hardened-P4)", f"codex: {CODEX}"]
            for i, (label, filesystem) in enumerate(FS_VARIANTS.items()):
                r = run(["/usr/bin/head", "-c", "60", "/etc/hosts"], f"P4v-{i}", flags(filesystem))
                lines += ["", f"--- {label} ---", f"flags: {' '.join(json.dumps(a) for a in flags(filesystem))}",
                          f"exit: {r['exit']}", "stdout:", r["stdout"], "stderr:", r["stderr"]]
                print(f"P4-variants: {label}: exit={r['exit']}", flush=True)
            (OUT / "hardened-P4-variants.txt").write_text("\n".join(lines) + "\n")
            continue
        records = []
        for i, (label, argv) in enumerate(PROBES[probe]):
            ESCAPE_TARGET.unlink(missing_ok=True)
            r = run(argv, f"{probe}-{i}")
            r["label"] = label
            if "write outside workspace" in label:
                r["escape_file_exists_after"] = ESCAPE_TARGET.exists()
                ESCAPE_TARGET.unlink(missing_ok=True)
            records.append(r)
        lines = [f"probe: {probe} (hardened)", f"codex: {CODEX} (codex-cli 0.169.0)",
                 f"CODEX_HOME: {CODEX_HOME} (empty, config only from the flags below)",
                 f"flags: codex sandbox {' '.join(json.dumps(a) for a in HARDENED)} -- <argv>"]
        if not records:
            lines.append("not-applicable: `codex sandbox` runs one argv with inherited stdio; there is no host tool to call.")
        for r in records:
            lines += ["", f"--- {r['label']} ---", f"argv: {json.dumps(r['argv'])}",
                      f"exit: {r['exit']}  wall_ms: {r['wall_ms']}  peak_tree_rss_mb: {r['peak_tree_rss_mb']}  killed: {r['killed']}"]
            if "escape_file_exists_after" in r:
                lines.append(f"escape_file_exists_after: {r['escape_file_exists_after']}")
            lines += ["stdout:", clip(r["stdout"]), "stderr:", clip(r["stderr"])]
        (OUT / f"hardened-{probe}.txt").write_text("\n".join(lines) + "\n")
        print(f"{probe}: " + "; ".join(f"{r['label']}: exit={r['exit']} {r['killed'] or ''}" for r in records), flush=True)


main(sys.argv[1:] or ["P1", "P3", "P4", "P5", "P9", "P12"])
