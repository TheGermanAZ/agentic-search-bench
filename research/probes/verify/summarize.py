"""One line per robustness record: python3 summarize.py [impl ...]. Reads verify/<impl>/out/<config>-<test>.json."""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMPLS = sys.argv[1:] or ["vercel-run", "vercel-ai-sdk-codemode", "tanstack-ai-codemode-node", "pi-codemode", "utcp-codemode", "asb-quickjs", "langchain-quickjs", "pydantic-ai-harness-codemode", "fastmcp-codemode", "openclaw-codemode-quickjs-wasi", "strands-codemode", "bifrost-codemode", "hermes-execute-code"]


def short(x, n=150):
    s = x if isinstance(x, str) else json.dumps(x)
    s = re.sub(r"\s+", " ", s)
    return s[:n]


def res(t):
    if not t:
        return "-"
    if not t.get("ok"):
        return f"THREW[{t.get('ms')}ms] {short(t.get('threw'), 140)}"
    r = t.get("result")
    v = r.get("value") if isinstance(r, dict) and "value" in r else r
    return f"ok[{t.get('ms')}ms] {short(v, 160)}"


def line(test, d):
    if d is None:
        return "no record"
    if "aggressors" in (d or {}):
        ag = d["aggressors"]
        agg = "; ".join(f"{a.get('ms')}ms {short(a.get('threw') or (a.get('result') or {}), 70)}" for a in ag[:2])
        return f"B: {res(d['b'])} || C: {res(d['c'])} || after: {res(d['after'])} || aggr({len(ag)}): {agg}"
    if test in ("R5", "R7b"):
        r = d.get("r")
        extra = f" atReturn={d.get('atReturn')} later={d.get('after3s') or d.get('after1500ms')}"
        return res(r) + extra + (f" after: {res(d.get('after'))}" if d.get("after") else "")
    if isinstance(d, dict) and "ok" in d:
        return res(d)
    return " | ".join(f"{k}: {res(v) if isinstance(v, dict) and 'ok' in v else short(v, 120)}" for k, v in d.items())


for impl in IMPLS:
    print(f"=== {impl}")
    for f in sorted((HERE / impl / "out").glob("*.json"), key=lambda p: (p.name.split("-")[0], int(re.sub(r"\D", "", p.name.split("-", 1)[1]) or 0), p.name)):
        try:
            w = json.load(open(f))
        except Exception as e:  # noqa: BLE001
            print(f"  {f.name}: unreadable {e}")
            continue
        if "record" not in w:
            continue
        rec = w["record"] or {}
        test = rec.get("test", f.stem)
        kill = w.get("watchKill")
        meta = f"peak={w.get('peakTreeRssMb')}MB" + (f" fp={w['peakTreeFootprintMb']}MB" if w.get('peakTreeFootprintMb') else '') + (f" ctr={rec['adapterStats'].get('containerPeakMb')}MB" if (rec.get('adapterStats') or {}).get('containerPeakMb') else '') + f" lag={rec.get('hostMaxEventLoopLagMs')}ms" + (f" KILL={kill['reason']}@{kill['atMs']}ms/{kill['rssMb']}MB" if kill and kill["reason"] != "exit-hang-after-record(3s)" else "")
        ev = rec.get("hostEvents") or []
        body = rec.get("harnessError") and ("HARNESS " + short(rec["harnessError"][-300:], 300)) or line(test, rec.get("data"))
        print(f"  {f.stem:16} {meta} :: {body}" + (f" EVENTS={short(ev, 200)}" if ev else ""))
