"""Shared probe runner for SPEC.md P1..P12 and the RUBRIC.md hardened run.

The same file is copied into each wave-2 probe folder that this worker owns. Each folder
adds an adapter.py that knows how to open a session, run one code string, and close it.

Usage, from the probe folder:
    python3 probe_core.py run <venv-python> <default|hardened> P1 P2 ...   # parent, system python
    <venv-python> probe_core.py child <default|hardened> <P>               # one probe, spawned by run
    python3 probe_core.py collect                                          # writes results/<impl>.json

The parent runs every probe in its own child process, in its own session so it can kill the
whole group. It stops a child at 120 s wall time or 4 GB RSS (summed over the child's process
tree, plus any docker container whose name starts with PROBE_DOCKER_PREFIX). The child writes
out/<tag>.raw.json; the parent classifies it into out/<tag>.json and out/<tag>.txt.
"""

import json
import os
import signal
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path.cwd()
OUT = HERE / "out"
CALL_LOG_ENV = "PROBE_CALL_LOG"
WALL_LIMIT_S = 120
RSS_LIMIT = 4 * 1024**3


def log_call(id_, start, end):
    """Host side of the lookup tool: one JSON line per call, shared by in-process and subprocess tools."""
    path = os.environ.get(CALL_LOG_ENV)
    if path:
        with open(path, "a") as f:
            f.write(json.dumps({"id": id_, "start": start, "end": end, "pid": os.getpid()}) + "\n")


def lookup_impl(id_):
    """The SPEC host tool body: wait 200 ms, return {id, value: id * 2}, count the call."""
    start = time.time()
    time.sleep(0.2)
    log_call(id_, start, time.time())
    return {"id": id_, "value": id_ * 2}


async def lookup_impl_async(id_):
    import asyncio

    start = time.time()
    await asyncio.sleep(0.2)
    log_call(id_, start, time.time())
    return {"id": id_, "value": id_ * 2}


def read_calls(path):
    try:
        return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    except FileNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Probe code. The adapter supplies call(i) (an awaited or plain call expression), coro(i)
# (an un-awaited call for asyncio.gather, or None when tools are sync), value(var), PRELUDE.
# ---------------------------------------------------------------------------

def probe_codes(ad):
    pre = getattr(ad, "PRELUDE", "")
    val = ad.value
    # Each probe prints its message and also leaves it as the last expression, so it comes back
    # whether the sandbox returns stdout, the last expression's value, or only one of them.
    codes = {
        "P1": [pre + f"r = {ad.call(21)}\nmsg = {val('r')}\nprint(msg)\nmsg"],
        "P2": ['print("A" * 200000)\n"RETURNED"'],
        "P3": ['import urllib.request\nr = urllib.request.urlopen("https://example.com", timeout=10)\nmsg = "HTTP " + str(r.status)\nprint(msg)\nmsg',
               # same URL without certificate verification, so a missing CA bundle in the venv's
               # Python does not hide whether the socket reached the network
               'import ssl, urllib.request\nr = urllib.request.urlopen("https://example.com", timeout=10, context=ssl._create_unverified_context())\nmsg = "HTTP " + str(r.status)\nprint(msg)\nmsg'],
        "P4": ['data = open("/etc/hosts").read()\nmsg = "HOSTS " + str(len(data)) + " chars, mentions localhost: " + str("localhost" in data)\nprint(msg)\nmsg'],
        "P5": ['import os\nmsg = "ENV " + str(os.environ.get("PROBE_SECRET"))\nprint(msg)\nmsg'],
        "P6": ["while True:\n    pass"],
        "P7": ["a = []\nwhile True:\n    a.append(\"x\" * 10**6)"],
        "P8": ["kept = 7", "try:\n    msg = kept\nexcept NameError:\n    msg = \"gone\"\nprint(msg)\nmsg"],
        "P10": ['x = 1\nraise ValueError("probe-boom")'],
        "P11": ["print(2)"],
        "P12": [
            "subs = ().__class__.__base__.__subclasses__()\nnames = [c.__name__ for c in subs]\nmsg = 'SUBS ' + str(len(subs)) + ' ' + str('_wrap_close' in names) + ' ' + str('Popen' in names)\nprint(msg)\nmsg",
            'msg = "SYSTEM " + str(__import__("os").system("echo PWNED"))\nprint(msg)\nmsg',
            "wc = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close']\nmsg = 'WRAP ' + wc[0].__init__.__globals__['popen']('echo PWNED2').read()\nprint(msg)\nmsg",
        ],
    }
    if ad.coro(1) is not None:
        items = ", ".join(ad.coro(i) for i in [1, 2, 3, 4, 5])
        codes["P9"] = [pre + f"import asyncio\nrs = await asyncio.gather({items})\nmsg = sum({val('x')} for x in rs)\nprint(msg)\nmsg"]
    else:
        codes["P9"] = [pre + f"tot = 0\nfor i in [1, 2, 3, 4, 5]:\n    x = {ad.call('i')}\n    tot += {val('x')}\nprint(tot)\ntot"]
    codes.update(getattr(ad, "EXTRA_PROBES", {}))
    codes.update(getattr(ad, "PROBE_OVERRIDES", {}))
    return codes


# ---------------------------------------------------------------------------
# Child: runs one probe through the adapter and writes the raw record.
# ---------------------------------------------------------------------------

def child(config, pid):
    import asyncio

    sys.path.insert(0, str(HERE))
    os.environ["PROBE_ID"] = pid
    import adapter as ad  # noqa: E402

    tag = ("hardened-" if config == "hardened" else "") + pid
    code_list = probe_codes(ad)[pid]
    raw = {"probe": pid, "config": config, "codes": code_list, "runs": []}
    raw_path = OUT / f"{tag}.raw.json"

    def flush():
        raw_path.write_text(json.dumps(raw, indent=2, default=repr))

    async def go():
        t0 = time.perf_counter()
        sess = await ad.open_session(config)
        raw["setup_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        flush()
        reps = 20 if pid == "P11" else 1
        for code in code_list:
            for _ in range(reps):
                t = time.perf_counter()
                started = time.time()
                try:
                    r = await ad.run(sess, code)
                except BaseException as e:  # noqa: BLE001 - every failure shape is data
                    r = {"ok": False, "error": f"{type(e).__name__}: {e}", "raised": True}
                r["ms"] = round((time.perf_counter() - t) * 1000, 1)
                r["started"] = started
                raw["runs"].append(r)
                flush()
        if pid == "P11":
            fresh = []
            for _ in range(5):
                t = time.perf_counter()
                s2 = await ad.open_session(config)
                await ad.run(s2, code_list[0])
                await ad.close_session(s2)
                fresh.append(round((time.perf_counter() - t) * 1000, 1))
            raw["fresh_session_ms"] = fresh
        try:
            await asyncio.wait_for(ad.close_session(sess), 10)
        except BaseException as e:  # noqa: BLE001 - a hung teardown is recorded, not fatal
            raw["close_error"] = f"{type(e).__name__}: {e}"

    # run_until_complete, then os._exit: asyncio.run would join leftover sandbox threads at
    # shutdown, and a sandbox that leaks a running thread must not turn into a harness hang.
    loop = asyncio.new_event_loop()
    loop.run_until_complete(go())
    raw["done"] = True
    flush()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


# ---------------------------------------------------------------------------
# Parent: process control, watchdog, classification.
# ---------------------------------------------------------------------------

def tree_rss(root):
    """RSS bytes of root and all descendants, from one ps snapshot."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    except Exception:
        return 0
    kids, rss = {}, {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        p, pp, r = (int(x) for x in parts)
        kids.setdefault(pp, []).append(p)
        rss[p] = r * 1024
    total, stack = 0, [root]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total


def docker_rss(prefix):
    if not prefix:
        return 0
    try:
        out = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        return 0
    units = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "kB": 1000, "MB": 1000**2, "GB": 1000**3}
    total = 0
    for line in out.splitlines():
        name, _, usage = line.partition(" ")
        if not name.startswith(prefix):
            continue
        used = usage.split("/")[0].strip()
        for u in sorted(units, key=len, reverse=True):
            if used.endswith(u):
                total += float(used[: -len(u)]) * units[u]
                break
    return int(total)


def run_one(py, config, pid):
    tag = ("hardened-" if config == "hardened" else "") + pid
    for suffix in (".raw.json", ".json", ".txt", ".log"):
        (OUT / f"{tag}{suffix}").unlink(missing_ok=True)
    call_log = OUT / f"{tag}.calls.jsonl"
    call_log.unlink(missing_ok=True)
    env = dict(os.environ, PROBE_SECRET="s3cr3t", **{CALL_LOG_ENV: str(call_log)})
    log = open(OUT / f"{tag}.log", "w")
    t0 = time.time()
    proc = subprocess.Popen([py, __file__, "child", config, pid], stdout=log, stderr=subprocess.STDOUT,
                            env=env, cwd=HERE, start_new_session=True)
    peak, killed, last_docker = 0, None, 0.0
    dprefix = os.environ.get("PROBE_DOCKER_PREFIX", "")
    drss = 0
    while proc.poll() is None:
        time.sleep(0.1)
        rss = tree_rss(proc.pid)
        if dprefix and time.time() - last_docker > 2:
            drss, last_docker = docker_rss(dprefix), time.time()
        peak = max(peak, rss + drss)
        if rss + drss >= RSS_LIMIT:
            killed = f"harness RSS watchdog at {(rss + drss) / 1024**3:.2f} GB after {time.time() - t0:.1f} s"
        elif time.time() - t0 >= WALL_LIMIT_S:
            killed = f"harness time watchdog at {time.time() - t0:.1f} s"
        if killed:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            break
    wall = time.time() - t0
    log.close()
    if dprefix:
        cleanup_docker(dprefix)
    kill_spawned()
    raw_path = OUT / f"{tag}.raw.json"
    raw = json.loads(raw_path.read_text()) if raw_path.exists() else {"runs": []}
    raw["killed"] = killed
    raw["exit_code"] = proc.returncode
    raw["wall_s"] = round(wall, 2)
    raw["peak_tree_rss_gb"] = round(peak / 1024**3, 3)
    raw["calls"] = read_calls(call_log)
    raw["child_log_tail"] = (OUT / f"{tag}.log").read_text(errors="replace")[-4000:]
    raw_path.write_text(json.dumps(raw, indent=2, default=repr))
    summary = classify(pid, raw)
    over = load_meta().get("overrides", {}).get(tag, {})
    summary.update(over)
    summary["evidence"] = f"research/probes/{HERE.name}/out/{tag}.txt"
    (OUT / f"{tag}.json").write_text(json.dumps(summary, indent=2))
    (OUT / f"{tag}.txt").write_text(render_txt(tag, raw, summary))
    print(json.dumps({"tag": tag, "outcome": summary["outcome"], "display": summary["display"]}), flush=True)


def kill_spawned():
    """Kill process groups an adapter recorded in out/spawned.pids (servers that a sandbox starts
    in their own session, which the child's process-group kill does not reach)."""
    f = OUT / "spawned.pids"
    if not f.exists():
        return
    for line in f.read_text().split():
        try:
            os.killpg(int(line), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, ValueError):
            pass
    f.unlink()


def cleanup_docker(prefix):
    out = subprocess.run(["docker", "ps", "-a", "--format", "{{.Names}}"], capture_output=True, text=True).stdout
    for name in out.split():
        if name.startswith(prefix):
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)


def render_txt(tag, raw, summary):
    lines = [f"probe: {tag}", f"outcome: {summary['outcome']}", f"display: {summary['display']}",
             f"detail: {summary['detail']}", "", "code:"]
    for c in raw.get("codes", []):
        lines += ["----", c]
    lines += ["----", "", f"setup_ms: {raw.get('setup_ms')}", f"wall_s (whole child process): {raw.get('wall_s')}",
              f"killed: {raw.get('killed')}", f"child exit code: {raw.get('exit_code')}",
              f"peak tree RSS GB: {raw.get('peak_tree_rss_gb')}", f"host lookup calls: {len(raw.get('calls', []))}"]
    for c in raw.get("calls", []):
        lines.append(f"  call id={c['id']} start={c['start']:.3f} end={c['end']:.3f} pid={c['pid']}")
    for i, r in enumerate(raw.get("runs", [])[:25]):
        lines.append(f"\n=== run {i} ({r.get('ms')} ms) ===")
        for k, v in r.items():
            if k in ("ms", "started"):
                continue
            s = v if isinstance(v, str) else json.dumps(v, default=repr)
            if isinstance(s, str) and len(s) > 3000:
                s = s[:1500] + f"\n...[{len(s)} chars; harness elided the middle of this evidence file only]...\n" + s[-1500:]
            lines.append(f"{k}: {s}")
    if raw.get("fresh_session_ms"):
        lines.append(f"\nfresh session (open+run+close) ms: {raw['fresh_session_ms']}")
    lines += ["", "=== child process log (tail) ===", raw.get("child_log_tail", "")]
    return "\n".join(lines) + "\n"


def text_of(r):
    return "\n".join(str(r.get(k) or "") for k in ("stdout", "result", "error", "stderr"))


def short(s, n=300):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[:n] + "..."


def failure_word(err):
    e = err or ""
    if any(x in e for x in ("ModuleNotFoundError", "NameError", "not supported", "not defined", "No module named", "is not allowed")):
        return "not-defined" if ("ModuleNotFoundError" in e or "No module named" in e or "NameError" in e) else "blocked"
    return "blocked"


def classify(pid, raw):
    # extras that repeat a SPEC probe with a different tool or setup share its rules
    if pid in ("P1s", "P3b", "P5b") or (pid.startswith("P9") and pid != "P9"):
        s = classify({"P1s": "P1", "P3b": "P3", "P5b": "P5"}.get(pid, "P9"), raw)
        s["probe"] = pid
        return s
    runs = raw.get("runs", [])
    calls = raw.get("calls", [])
    r = runs[0] if runs else {}
    killed = raw.get("killed")
    crashed = not raw.get("done") and not killed
    s = {"probe": pid}

    def done(outcome, display, detail):
        s.update(outcome=outcome, display=display[:40], detail=detail)
        return s

    if crashed and not runs:
        return done("error", "host crash", f"child process died (exit {raw.get('exit_code')}) before any result; log: {short(raw.get('child_log_tail'), 500)}")
    if killed and pid not in ("P6", "P7"):
        return done("error", "hung (harness stop)", f"{killed}; no result came back")

    if pid == "P1":
        t = text_of(r)
        ok = "42" in (r.get("stdout") or "") or "42" in (r.get("result") or "")
        return done("works" if ok and len(calls) == 1 else "error",
                    f"works (42, {len(calls)} call)" if ok else "error",
                    f"42 in printed stdout: {'42' in (r.get('stdout') or '')}; 42 in returned value: {'42' in (r.get('result') or '')}; output {short(t, 200)!r}; host lookup calls: {len(calls)}")
    if pid == "P2":
        t = text_of(r)
        a = t.count("A")
        got_ret = "RETURNED" in t
        marker = next((m for m in ("truncat", "elided", "omitted", "...") if m in t.lower()), None)
        trunc = a < 200000
        disp = f"truncated ({a:,} A)" if trunc else f"full ({a:,} A)"
        if trunc and marker:
            disp = f"truncated ({a:,} + marker)"
        return done("limited" if trunc else "works", disp,
                    f"RETURNED came back: {got_ret} (in {'result' if 'RETURNED' in str(r.get('result')) else 'stdout' if 'RETURNED' in str(r.get('stdout')) else 'nowhere'}); "
                    f"{a} of 200000 A's came back; marker found: {marker!r}; stdout chars {len(r.get('stdout') or '')}; error {short(r.get('error'), 200)!r}")
    if pid == "P3":
        t = text_of(r)
        t2 = text_of(runs[1]) if len(runs) > 1 else ""
        if "HTTP 200" in t:
            return done("works", "works (example.com 200)", "printed HTTP 200 from https://example.com")
        if "HTTP 200" in t2:
            return done("works", "works (example.com 200)", f"spec form failed with {short(r.get('error') or t, 200)!r}; same URL with an unverified SSL context printed HTTP 200, so the socket reached the network")
        w = failure_word(r.get("error") or t)
        return done(w, w, short(r.get("error") or t, 400))
    if pid == "P4":
        t = text_of(r)
        if "HOSTS" in (r.get("stdout") or ""):
            return done("works", "works (read /etc/hosts)", short(r.get("stdout"), 200))
        w = failure_word(r.get("error") or t)
        return done(w, w, short(r.get("error") or t, 400))
    if pid == "P5":
        t = text_of(r)
        if "s3cr3t" in t:
            return done("works", "works (s3cr3t)", "sandbox printed 's3cr3t'; host PROBE_SECRET was set")
        if "ENV None" in t:
            return done("blocked", "blocked (env empty)", "os.environ has no PROBE_SECRET (printed None); host had it set")
        w = failure_word(r.get("error") or t)
        return done(w, w, short(r.get("error") or t, 400))
    if pid == "P6":
        if killed:
            return done("no-limit-within-120s", "no-limit-within-120s", f"{killed}; nothing stopped the loop")
        if crashed:
            return done("error", "host crash", f"child died (exit {raw.get('exit_code')}) after {raw.get('wall_s')} s")
        secs = r.get("ms", 0) / 1000
        return done("limited", f"limited ({secs:.1f} s)", f"stopped after {secs:.2f} s: {short(r.get('error') or text_of(r), 400)}")
    if pid == "P7":
        peak = raw.get("peak_tree_rss_gb")
        if killed:
            return done("no-limit-within-120s", "no-limit-within-120s" if "time" in killed else f"no limit (killed at {peak:.1f} GB)",
                        f"{killed}; peak tree RSS {peak} GB; no error from the sandbox")
        if crashed:
            return done("error", "host crash", f"child died (exit {raw.get('exit_code')}) at peak RSS {peak} GB; log {short(raw.get('child_log_tail'), 300)}")
        return done("limited", f"limited (peak {peak * 1024:.0f} MB)", f"stopped after {r.get('ms', 0) / 1000:.2f} s, peak tree RSS {peak} GB: {short(r.get('error') or text_of(r), 400)}")
    if pid == "P8":
        r2 = runs[1] if len(runs) > 1 else {}
        t = text_of(r2)
        if "gone" not in t and ("7" in (r2.get("stdout") or "") or "7" in str(r2.get("result") or "")):
            return done("works", "persists", f"execution 2 printed {short(t, 100)!r}")
        if "gone" in t or "NameError" in t:
            return done("works", "fresh", f"execution 2: {short(t, 200)!r}")
        return done("error", "error", f"exec1 {short(text_of(r), 200)!r}; exec2 {short(t, 200)!r}")
    if pid == "P9":
        if len(calls) < 5:
            return done("error", "error", f"{len(calls)} host calls; {short(text_of(r), 400)}")
        last5 = sorted(calls, key=lambda c: c["start"])[-5:]  # skip a warm-up call if there is one
        span = (max(c["end"] for c in last5) - min(c["start"] for c in last5)) * 1000
        mode = "parallel" if span < 600 else "serial" if span > 900 else "partial"
        return done("works", f"{mode} ({span:,.0f} ms)",
                    f"5 host calls spanning {span:.0f} ms host-side (first start to last end); execution wall {r.get('ms')} ms; output {short(text_of(r), 100)!r}")
    if pid == "P10":
        t = text_of(r)
        has_msg = "probe-boom" in t
        has_line = "line 2" in t
        return done("works" if has_msg else "error", f"{'message' if has_msg else 'no message'}{' + line' if has_line else ', no line'}",
                    f"message survives: {has_msg}; 'line 2' present: {has_line}; text: {short(t, 600)!r}")
    if pid == "P11":
        ms = [x["ms"] for x in runs if x.get("ms") is not None]
        if not ms:
            return done("error", "error", "no runs")
        ms_sorted = sorted(ms)
        med = statistics.median(ms)
        p90 = ms_sorted[int(0.9 * (len(ms_sorted) - 1))]
        fresh = raw.get("fresh_session_ms") or []
        return done("works", f"median {med:.1f} ms", f"20 runs in one session: median {med:.1f} ms, p90 {p90:.1f} ms; one-time setup {raw.get('setup_ms')} ms; "
                    f"fresh session per run (open+run+close, n={len(fresh)}): median {statistics.median(fresh) if fresh else None} ms")
    if pid == "P12":
        parts, escaped = [], False
        names = ["P12a subclasses walk", "P12b __import__('os').system", "P12c _wrap_close globals popen"]
        for i, run in enumerate(runs):
            t = text_of(run)
            hit = ("SYSTEM 0" in t) or ("WRAP PWNED2" in t)
            escaped = escaped or hit
            parts.append(f"{names[i] if i < len(names) else i}: {'ran' if run.get('ok') else 'failed'}; {short(t, 220)!r}")
        return done("escaped" if escaped else "blocked", "escaped (os.system)" if escaped else "blocked", " | ".join(parts))
    # extras: report the raw text
    t = text_of(r)
    return done("works" if r.get("ok") else "error", short(t, 40) or "error", short(t, 500))


def load_meta():
    p = HERE / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def collect():
    meta = load_meta()
    probes, hardened = {}, {}
    for f in sorted(OUT.glob("*.json")):
        if f.name.endswith(".raw.json"):
            continue
        d = json.loads(f.read_text())
        if f.stem not in (d.get("probe"), f"hardened-{d.get('probe')}"):
            continue  # side evidence such as setup-crash-*.json, not a probe record
        d.update(meta.get("overrides", {}).get(f.stem, {}))
        entry = {k: d[k] for k in ("outcome", "detail", "evidence", "display")}
        (hardened if f.stem.startswith("hardened-") else probes)[d["probe"]] = entry
    order = lambda k: (int("".join(c for c in k[1:] if c.isdigit()) or 99), k)  # noqa: E731
    res = {
        "impl": meta["impl"], "name": meta["name"], "source": meta["source"], "pinned": meta["pinned"],
        "language": meta["language"], "engine": meta["engine"], "how_run": meta["how_run"],
        "probes": {k: probes[k] for k in sorted(probes, key=order)},
        "defaults": meta["defaults"],
        "hardened": ({"config": meta["hardened_config"], "probes": {k: hardened[k] for k in sorted(hardened, key=order)}}
                     if meta.get("hardened_config") else None),
        "source_notes": meta["source_notes"],
        "surprises": meta["surprises"],
    }
    dest = HERE.parent / "results" / f"{meta['impl']}.json"
    dest.write_text(json.dumps(res, indent=2) + "\n")
    print(f"wrote {dest}")


def reclassify():
    """Rebuild out/<tag>.json and .txt from the saved raw records (after a classifier change)."""
    meta = load_meta()
    for rawf in sorted(OUT.glob("*.raw.json")):
        tag = rawf.name[: -len(".raw.json")]
        raw = json.loads(rawf.read_text())
        if "killed" not in raw:
            # records from before run_one saved the parent's fields: recover them from the .txt
            txt = OUT / f"{tag}.txt"
            if not txt.exists():
                continue
            fields = dict(line.split(": ", 1) for line in txt.read_text().splitlines()[:40] if ": " in line)
            raw["killed"] = None if fields.get("killed") in (None, "None") else fields["killed"]
            raw["exit_code"] = int(fields.get("child exit code", "0"))
            raw["wall_s"] = float(fields.get("wall_s (whole child process)", "0"))
            raw["peak_tree_rss_gb"] = float(fields.get("peak tree RSS GB", "0"))
            raw["calls"] = read_calls(OUT / f"{tag}.calls.jsonl")
            log = OUT / f"{tag}.log"
            raw["child_log_tail"] = log.read_text(errors="replace")[-4000:] if log.exists() else ""
            rawf.write_text(json.dumps(raw, indent=2, default=repr))
        pid = tag[len("hardened-"):] if tag.startswith("hardened-") else tag
        summary = classify(pid, raw)
        summary.update(meta.get("overrides", {}).get(tag, {}))
        summary["evidence"] = f"research/probes/{HERE.name}/out/{tag}.txt"
        (OUT / f"{tag}.json").write_text(json.dumps(summary, indent=2))
        (OUT / f"{tag}.txt").write_text(render_txt(tag, raw, summary))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    cmd = sys.argv[1]
    if cmd == "run":
        py, config = sys.argv[2], sys.argv[3]
        for p in sys.argv[4:]:
            run_one(py, config, p)
    elif cmd == "child":
        child(sys.argv[2], sys.argv[3])
    elif cmd == "collect":
        collect()
    elif cmd == "reclassify":
        reclassify()
