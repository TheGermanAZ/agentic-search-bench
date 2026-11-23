"""Shared probe driver for Python code-mode sandboxes (SPEC.md P1-P12 plus the RUBRIC hardened run).

An adapter module supplies how to run code. The driver owns the probe code, timing, the
120 s / 4 GB watchdog, classification and the out/ files. One probe runs per process
(see run_all.sh) so a stuck P6/P7 cannot distort later probes.

Adapter contract (module-level names in adapter.py):
    IMPL: str
    new_session(hardened: bool) -> session object with .run(code) -> dict and .close()
        run() returns {"ok": bool, "stdout": str, "result": Any, "error": str | None}
    lookup_call(id_expr: str) -> str   Python expression that calls the lookup tool
    prelude: str                        code prepended to tool-calling probes (may be "")
    host_calls() -> int                 host-side lookup call count
    extra_rss() -> int                  bytes held outside this process tree (e.g. a container), or 0
    kill_all()                          stop anything the adapter started (watchdog path)
    CODES: dict                         optional per-probe code overrides
"""

import json
import os
import statistics
import sys
import threading
import time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
REPO = HERE.parents[2]
HOST_HOSTS = Path("/etc/hosts").read_text()
CANARY = HERE / "canary.txt"
CANARY.write_text("host-canary-7f3a\n")
PWN_MARK = OUT / "P12-escape-marker.txt"

sys.path.insert(0, str(HERE))
import adapter as A  # noqa: E402

LOOKUP_DOC = "lookup waits 200 ms on the host side, then returns {id, value: id * 2}"


def host_lookup_factory(counter):
    def lookup(id):
        counter["n"] += 1
        time.sleep(0.2)
        return {"id": id, "value": id * 2}
    return lookup


def tree_rss():
    me = psutil.Process()
    total = 0
    for p in [me] + me.children(recursive=True):
        try:
            total += p.memory_info().rss
        except psutil.Error:
            pass
    return total + A.extra_rss()


def timed_run(session, code):
    t0 = time.perf_counter()
    try:
        r = session.run(code)
    except BaseException as e:  # noqa: BLE001
        r = {"ok": False, "stdout": "", "result": None, "error": f"{type(e).__name__}: {e}"}
    r["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return r


def write(pid, raw, summary):
    (OUT / f"{pid}.txt").write_text(raw)
    (OUT / f"{pid}.json").write_text(json.dumps(summary, indent=2, default=str))
    print(json.dumps(summary, default=str)[:400], flush=True)


def note(r):
    f = getattr(A, "call_note", None)
    return f"; {f(r)}" if f else ""


def both(r):
    res = r.get("result")
    return (r.get("stdout") or "") + ("\n" + str(res) if res is not None else "")


def short(r, n=1500):
    s = json.dumps({k: r.get(k) for k in ("ok", "result", "error", "ms")}, default=str)
    out = r.get("stdout") or ""
    return s + f"\nstdout ({len(out)} chars): {out[:n]!r}"


def watchdog(pid, header, seconds, rss_limit=None, hardened=False):
    start = time.perf_counter()
    peak = {"rss": 0}

    def loop():
        while True:
            time.sleep(0.05)
            el = time.perf_counter() - start
            rss = tree_rss()
            peak["rss"] = max(peak["rss"], rss)
            hit_mem = rss_limit is not None and rss >= rss_limit
            if hit_mem or el >= seconds:
                why = (f"harness stopped it at {rss / 1024**3:.2f} GB RSS after {el:.1f} s" if hit_mem
                       else f"still running after {el:.1f} s, harness stopped it")
                disp = (f"no-limit-within-120s ({rss / 1024**3:.1f} GB)" if hit_mem
                        else "no-limit-within-120s")
                s = {"probe": pid, "outcome": "no-limit-within-120s", "detail": why,
                     "display": disp, "peak_rss_mb": round(peak["rss"] / 1024**2), "wall_s": round(el, 1)}
                write(pid, header + f"\nwatchdog: {why}\n", s)
                try:
                    A.kill_all()
                finally:
                    os._exit(0)

    threading.Thread(target=loop, daemon=True).start()
    return peak


def classify_err(err):
    e = err or ""
    if any(k in e for k in ("is not defined", "NameError", "not-defined")):
        return "not-defined"
    return "blocked"


def py(pid):
    L = A.lookup_call
    codes = {
        "P1": A.prelude + f"r = {L('21')}\nprint(r['value'])",
        "P2": 'print("A" * 200000)\n"RETURNED"',
        "P3": 'import urllib.request\nr = urllib.request.urlopen("https://example.com", timeout=20)\nprint("STATUS", r.status)',
        "P4": 'print(open("/etc/hosts").read())',
        "P5": 'import os\nprint("ENV=" + str(os.environ.get("PROBE_SECRET")))',
        "P6": "while True:\n    pass",
        "P7": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
        "P8a": "kept = 7",
        "P8b": 'try:\n    print(kept)\nexcept NameError:\n    print("gone")',
        "P9": A.prelude + "import time\nt = time.time()\nrs = [" + L("i") + " for i in [1, 2, 3, 4, 5]]\nprint(int((time.time() - t) * 1000))",
        "P10": 'x = 1\nraise ValueError("probe-boom")',
        "P11": "print(2)",
        "P12a": ("subs = ().__class__.__base__.__subclasses__()\n"
                 "names = [c.__name__ for c in subs]\n"
                 "print('wrap_close' if '_wrap_close' in names else 'no-wrap_close', 'Popen' if 'Popen' in names else 'no-Popen')\n"
                 "w = [c for c in subs if c.__name__ == '_wrap_close'][0]\n"
                 f"w.__init__.__globals__['system']('echo PWNED-a; echo PWNED-a > {PWN_MARK}')"),
        "P12b": f'__import__("os").system("echo PWNED-b; echo PWNED-b >> {PWN_MARK}")',
    }
    codes.update(getattr(A, "CODES", {}))
    return codes[pid]


def p_simple(pid, hardened, ok_test, fmt):
    s = A.new_session(hardened)
    code = py(pid)
    r = timed_run(s, code)
    s.close()
    out = (r.get("stdout") or "") + str(r.get("result") or "")
    if r["ok"] and ok_test(out):
        outcome = "works"
    elif r["ok"]:
        outcome = "blocked"
    else:
        outcome = classify_err(r["error"])
    detail, display = fmt(outcome, r, out)
    return f"probe {pid} hardened={hardened}\ncode:\n{code}\n\n{short(r)}", {"probe": pid, "outcome": outcome, "detail": detail, "display": display}


def P1(h):
    n0 = A.host_calls()
    s = A.new_session(h)
    r = timed_run(s, py("P1"))
    s.close()
    n = A.host_calls() - n0
    out = both(r).strip()
    ok = r["ok"] and "42" in out
    return (f"code:\n{py('P1')}\n\n{short(r)}\nhost_calls={n}",
            {"probe": "P1", "outcome": "works" if ok else classify_err(r["error"]) if not r["ok"] else "error",
             "detail": f"printed {out[-80:]!r}, {n} host-side calls{note(r)}; error={r['error']!s:.300}",
             "display": f"works (42, {n} host call)" if ok else "error", "host_calls": n})


def P2(h):
    s = A.new_session(h)
    r = timed_run(s, py("P2"))
    s.close()
    out = r.get("stdout") or ""
    a = out.count("A")
    res = r.get("result")
    got_ret = "RETURNED" in str(res) or "RETURNED" in out
    marker = [m for m in ("truncat", "omitted", "...") if m in out]
    if a >= 200000:
        disp = f"full ({a:,} chars)"
    elif a == 0:
        disp = "print dropped"
    else:
        disp = f"truncated ({a:,}{' + marker' if marker else ', no marker'})"
    return (f"code:\n{py('P2')}\n\n{short(r, 600)}",
            {"probe": "P2", "outcome": "works" if r["ok"] else "error",
             "detail": f"return value back: {got_ret} (result={str(res)[:60]!r}); print chars back: {a}; marker: {marker}; error={r['error']!s:.200}",
             "display": disp + ("" if got_ret else ", no return"), "a_count": a, "returned": got_ret})


def P3(h):
    return p_simple("P3", h, lambda o: "STATUS 200" in o,
                    lambda oc, r, o: (f"{o.strip()[:200] or r['error']!s:.500}",
                                      "works (example.com 200)" if oc == "works" else oc))


def P4(h):
    def ok(o):
        return HOST_HOSTS.strip()[:200] in o
    def fmt(oc, r, o):
        if oc == "works":
            return f"read host /etc/hosts ({len(HOST_HOSTS)} chars, matches host)", "works (host /etc/hosts)"
        if r["ok"]:
            return f"read a file but not the host's: {o[:200]!r}", "blocked (own /etc/hosts)"
        return f"{r['error']!s:.500}", oc
    return p_simple("P4", h, ok, fmt)


def P5(h):
    return p_simple("P5", h, lambda o: "s3cr3t" in o,
                    lambda oc, r, o: (f"{o.strip()[:200] or r['error']!s:.500}",
                                      "works (s3cr3t)" if oc == "works" else (f"blocked ({o.strip()[:30]})" if r["ok"] else oc)))


def P6(h):
    code = py("P6")
    hdr = f"probe P6 hardened={h}\ncode:\n{code}\n"
    s = A.new_session(h)
    watchdog("hardened-P6" if h else "P6", hdr, 120, hardened=h)
    r = timed_run(s, code)
    s.close()
    secs = r["ms"] / 1000
    return (hdr + short(r), {"probe": "P6", "outcome": "limited" if not r["ok"] else "error",
                             "detail": f"stopped after {secs:.1f} s: {r['error']!s:.400}",
                             "display": f"limited ({secs:.0f} s)" if not r["ok"] else "error", "wall_s": round(secs, 1)})


def P7(h):
    code = py("P7")
    hdr = f"probe P7 hardened={h}\ncode:\n{code}\n"
    s = A.new_session(h)
    base = tree_rss()
    peak = watchdog("hardened-P7" if h else "P7", hdr, 120, rss_limit=4 * 1024**3, hardened=h)
    r = timed_run(s, code)
    alive = True
    try:
        r2 = timed_run(s, "print(1+1)")
        after = f"same session after P7: ok={r2['ok']} stdout={r2.get('stdout')!r} error={r2.get('error')!s:.200}"
    except BaseException as e:  # noqa: BLE001
        after, alive = f"same session after P7 raised {e}", False
    s.close()
    s2 = A.new_session(h)
    r3 = timed_run(s2, "print(1+1)")
    s2.close()
    pk = round(peak["rss"] / 1024**2)
    return (hdr + short(r) + f"\nbaseline tree RSS {base / 1024**2:.0f} MB, peak {pk} MB\n{after}\nfresh session after: {short(r3, 100)}",
            {"probe": "P7", "outcome": "limited" if not r["ok"] else "error",
             "detail": f"stopped after {r['ms'] / 1000:.1f} s, peak tree RSS {pk} MB: {r['error']!s:.400}. {after}. fresh session ok={r3['ok']}",
             "display": f"limited ({pk:,} MB peak)", "peak_rss_mb": pk, "host_survived": True})


def P8(h):
    s = A.new_session(h)
    r1 = timed_run(s, py("P8a"))
    r2 = timed_run(s, py("P8b"))
    s.close()
    out = both(r2).strip() or str(r2.get("error"))
    oc = "persists" if out.endswith("7") else "fresh" if ("gone" in out or "'kept' is not defined" in out) else "error"
    return (f"exec1:\n{short(r1)}\nexec2:\n{short(r2)}", {"probe": "P8", "outcome": oc, "detail": f"second execution printed {out!r}", "display": oc})


def P9(h):
    n0 = A.host_calls()
    s = A.new_session(h)
    code = py("P9")
    r = timed_run(s, code)
    s.close()
    n = A.host_calls() - n0
    out = both(r).strip().splitlines()
    ms = None
    for line in reversed(out):
        if line.strip().isdigit():
            ms = int(line.strip())
            break
    if ms is None:
        return (f"code:\n{code}\n\n{short(r)}", {"probe": "P9", "outcome": classify_err(r["error"]) if not r["ok"] else "error",
                                                 "detail": f"{r['error']!s:.400}", "display": "error", "host_calls": n})
    kind = "parallel" if ms < 600 else "serial"
    return (f"code:\n{code}\n\n{short(r)}\nhost_calls={n}",
            {"probe": "P9", "outcome": "works", "detail": f"{ms} ms for five 200 ms lookups ({kind}); {n} host-side calls{note(r)}",
             "display": f"{kind} ({ms:,} ms)", "elapsed_ms": ms, "host_calls": n})


def P10(h):
    s = A.new_session(h)
    r = timed_run(s, py("P10"))
    s.close()
    text = f"{r.get('error') or ''}\n{r.get('stdout') or ''}"
    msg = "probe-boom" in text
    line = "line 2" in text or ":2" in text
    return (f"code:\n{py('P10')}\n\n{short(r, 4000)}",
            {"probe": "P10", "outcome": "works", "detail": f"returned: {text.strip()[:700]!r}; message survives: {msg}; line number survives: {line}",
             "display": f"{'message' if msg else 'no message'}{' + line' if line else ', no line'}"})


def P11(h):
    t0 = time.perf_counter()
    s = A.new_session(h)
    setup_ms = (time.perf_counter() - t0) * 1000
    same = []
    for _ in range(20):
        same.append(timed_run(s, py("P11"))["ms"])
    s.close()
    fresh = []
    for _ in range(20):
        t = time.perf_counter()
        s = A.new_session(h)
        r = s.run(py("P11"))
        s.close()
        fresh.append((time.perf_counter() - t) * 1000)

    def stats(xs):
        xs = sorted(xs)
        return statistics.median(xs), xs[int(0.9 * len(xs)) - 1]
    sm, sp = stats(same)
    fm, fp = stats(fresh)
    per_run_fresh = getattr(A, "RUN_IS_FRESH", False)
    med, p90, what = (sm, sp, "execution (each one a fresh process)") if per_run_fresh else (fm, fp, "fresh session + execution")
    return (f"first session setup {setup_ms:.1f} ms\nsame session, 20 runs (ms): {same}\nnew session + run, 20x (ms): {[round(x, 1) for x in fresh]}\nlast: {r}",
            {"probe": "P11", "outcome": "works",
             "detail": f"per {what}: median {med:.1f} ms, p90 {p90:.1f} ms. Same-session runs median {sm:.1f} / p90 {sp:.1f} ms; new session + run median {fm:.1f} / p90 {fp:.1f} ms; one-time setup {setup_ms:.1f} ms",
             "display": f"median {med:,.1f} ms", "median_ms": round(med, 1), "p90_ms": round(p90, 1), "setup_ms": round(setup_ms, 1),
             "same_session_median_ms": round(sm, 1), "new_session_median_ms": round(fm, 1)})


def P12(h):
    parts, raw, any_escape, all_blocked = [], "", False, True
    PWN_MARK.unlink(missing_ok=True)
    for sub in ("P12a", "P12b") + tuple(k for k in getattr(A, "CODES", {}) if k.startswith("P12") and k not in ("P12a", "P12b")):
        s = A.new_session(h)
        r = timed_run(s, py(sub))
        s.close()
        marker = PWN_MARK.exists() and sub[-1] in PWN_MARK.read_text()
        out = (r.get("stdout") or "") + str(r.get("result") or "")
        if marker:
            oc = "escaped"
            any_escape = True
            all_blocked = False
        elif r["ok"]:
            oc = "blocked (ran, no host marker)"
        else:
            oc = classify_err(r["error"])
        parts.append(f"{sub}: {oc}: {(out.strip() or r['error'] or '')[:250]!s}")
        raw += f"--- {sub}\ncode:\n{py(sub)}\n{short(r)}\nhost marker written: {marker}\n"
    raw += f"\nmarker file contents: {PWN_MARK.read_text() if PWN_MARK.exists() else '(absent)'}\n"
    oc = "escaped" if any_escape else "blocked"
    how = [p.split(":")[0] for p in parts if ": escaped" in p]
    return raw, {"probe": "P12", "outcome": oc, "detail": " | ".join(parts),
                 "display": f"escaped ({', '.join(how)})" if any_escape else "blocked"}


def PX(h):
    raw, parts = "", []
    for name, (code, why) in getattr(A, "EXTRAS", {}).items():
        s = A.new_session(h)
        for c in (code if isinstance(code, list) else [code]):
            r = timed_run(s, c)
            raw += f"--- {name}: {why}\ncode:\n{c}\n{short(r, 600)}\n\n"
        s.close()
        parts.append(f"{name}: ok={r['ok']} out={both(r).strip()[:120]!r} err={r['error']!s:.160}")
    return raw, {"probe": "PX", "outcome": "works", "detail": " | ".join(parts), "display": "extras"}


PROBES = {f"P{i}": globals()[f"P{i}"] for i in range(1, 13)}
PROBES["PX"] = PX

if __name__ == "__main__":
    hardened = "--hardened" in sys.argv
    for pid in [a for a in sys.argv[1:] if not a.startswith("--")]:
        raw, summary = PROBES[pid](hardened)
        summary["config"] = "hardened" if hardened else "default"
        write(os.environ.get("PROBE_PREFIX", "") + ("hardened-" if hardened else "") + pid, raw, summary)
    A.kill_all()
