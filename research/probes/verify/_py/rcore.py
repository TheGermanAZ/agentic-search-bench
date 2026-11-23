"""Robustness checks beyond SPEC.md for Python-hosted implementations (same test ids as _js/rcore.mjs).

Usage: <venv python> rcore.py <adapter.py> <config> <testId>
The adapter module defines `async def make(config, host)` returning an object with:
  lang ('js' or 'py'), T, F, R (guest call expressions for lookup/failing/rich, given an args string),
  async exec(code) -> raw result (runs on ONE shared agent/server, like a multi-user server), optional close().
Prints one '@@RECORD@@{json}' line; _js/rwatch.mjs wraps it with RSS sampling and the 4 GB / 120 s kill.
"""
import asyncio
import datetime
import importlib.util
import json
import os
import sys
import time
import traceback

adapter_path, config, test_id = sys.argv[1:4]
os.environ["PROBE_SECRET"] = "s3cr3t"
T0 = time.perf_counter()


def now():
    return round((time.perf_counter() - T0) * 1000)


state = {"started": 0, "done": 0}


async def lookup(id):
    state["started"] += 1
    await asyncio.sleep(0.2)
    state["done"] += 1
    return {"id": id, "value": id * 2}


async def failing():
    raise RuntimeError("host-tool-boom internal detail db=postgres://user:pw@host")


async def rich():
    return {"fn": (lambda: "HOST-FN-CALLED"), "d": datetime.datetime(1970, 1, 1), "s": "plain", "st": {1, 2}}


host = {"lookup": lookup, "failing": failing, "rich": rich}

spec = importlib.util.spec_from_file_location("adapter", adapter_path)
ad = importlib.util.module_from_spec(spec)
sys.path.insert(0, os.path.dirname(adapter_path))
spec.loader.exec_module(ad)

max_lag = 0.0


async def lag_monitor():
    global max_lag
    last = time.perf_counter()
    while True:
        await asyncio.sleep(0.02)
        t = time.perf_counter()
        max_lag = max(max_lag, (t - last - 0.02) * 1000)
        last = t


def clip(v):
    s = json.dumps(v, default=repr)
    obj = json.loads(s)

    def walk(x):
        if isinstance(x, str):
            return x if len(x) <= 900 else f"{x[:500]}…[{len(x)} chars]…{x[-300:]}"
        if isinstance(x, list):
            return [walk(i) for i in x]
        if isinstance(x, dict):
            return {k: walk(i) for k, i in x.items()}
        return x

    return walk(obj)


CAP_S = 110


async def timed(a, code, label=""):
    if code is None:
        return {"label": label, "notApplicable": True}
    start = now()
    before = dict(state)
    try:
        r = await asyncio.wait_for(a.exec(code), CAP_S)
        return {"label": label, "startMs": start, "ms": now() - start, "ok": True, "result": clip(r), "callsStarted": state["started"] - before["started"]}
    except asyncio.TimeoutError:
        return {"label": label, "startMs": start, "ms": now() - start, "ok": False, "threw": f"NO-RETURN within {CAP_S} s", "callsStarted": state["started"] - before["started"]}
    except BaseException as e:  # noqa: BLE001
        return {"label": label, "startMs": start, "ms": now() - start, "ok": False, "threw": f"{type(e).__name__}: {e}"[:1500], "callsStarted": state["started"] - before["started"]}


def js_codes(a):
    T, F, R = a.T, a.F, a.R
    out = lambda e: f"console.log(JSON.stringify({e}));"  # noqa: E731
    esc = lambda e: f'(()=>{{try{{return String({e})}}catch(x){{return "threw "+(x&&x.message)}}}})()'  # noqa: E731
    return {
        "LOOP": "while (true) {}",
        "BOMB": 'const a = []; while (true) a.push("x".repeat(1e6));',
        "FLOOD": 'while (true) console.log("x".repeat(1e6));',
        "REGEX": 'const t = Date.now(); const m = /^(a+)+$/.test("a".repeat(40) + "b");',
        "NORMAL": f"const r = await {T}({{id: 21}}); {out('r.value')}",
        "R1A": f'Object.prototype.polluted = "A"; Array.prototype.leak = "A"; globalThis.leftover = "A-secret"; JSON.stringify = function () {{ return "hijacked"; }}; {out(chr(34) + "set" + chr(34))}',
        "R1B": out("[typeof ({}).polluted, typeof [].leak, typeof globalThis.leftover, JSON.stringify({a: 1})]"),
        "R1cA": f'Object.prototype.pollutedC = "A"; globalThis.leftC = "A-secret"; await {T}({{id: 1}}); await {T}({{id: 2}}); {out(chr(34) + "A done" + chr(34))}',
        "R1cB": out("[typeof ({}).pollutedC, typeof globalThis.leftC]"),
        "R2a": "const r = await " + T + "({id: 1}); " + out("[Object.getPrototypeOf(r) === Object.prototype, " + esc('r.constructor.constructor("return typeof process")()') + ", " + esc(T + '.constructor("return typeof process")()') + ", Object.getOwnPropertyNames(globalThis).join(',')]"),
        "R2b": f'let o; try {{ await {F}({{}}); o = "no throw"; }} catch (e) {{ o = {{ type: typeof e, name: e && e.name, msg: String(e && e.message !== undefined ? e.message : e), stack: String(e && e.stack || "").slice(0, 800), own: Object.getOwnPropertyNames(Object(e)), esc: {esc("e.constructor.constructor(" + chr(34) + "return typeof process" + chr(34) + ")()")} }}; }} {out("o")}',
        "R2c": f"const r = await {R}({{}}); {out('{ keys: Object.keys(r || {}), fn: typeof (r && r.fn), s: String(r && r.fn), d: String(r && r.d) }')}",
        "R3": f'function f(n) {{ return f(n + 1) + 1; }} let o; try {{ f(0); o = "no throw"; }} catch (e) {{ o = String(e); }} {out("o")}',
        "R3deep": "const root = []; let x = root; for (let i = 0; i < 100000; i++) { x[0] = []; x = x[0]; } root",
        "ALIVE": out('"alive"'),
        "R4": f"const t = Date.now(); const m = /^(a+)+$/.test(\"a\".repeat(40) + \"b\"); {out('[m, Date.now() - t]')}",
        "R5": f"const rs = await Promise.all(Array.from({{length: 2000}}, (_, i) => {T}({{id: i}}))); {out('rs.length')}",
        "R6": f"await {T}({{id: 1}}); while (true) {{}}",
        "R7a": f"await new Promise(() => {{}}); {out(chr(34) + 'resolved?' + chr(34))}",
        "R7b": f"for (let i = 0; i < 5; i++) {T}({{id: i}}); while (true) {{}}",
        "R8a": f'console.log("x".repeat(20 * 1024 * 1024)); {out(chr(34) + "done" + chr(34))}',
        "R8b": '"y".repeat(20 * 1024 * 1024)',
    }


def py_codes(a):
    T, F, R = a.T, a.F, a.R
    return {
        "LOOP": "while True:\n    pass",
        "BOMB": 'a = []\nwhile True:\n    a.append("x" * 10**6)',
        "FLOOD": 'while True:\n    print("x" * 10**6)',
        "REGEX": 'import re\nm = re.match(r"^(a+)+$", "a" * 40 + "b")',
        "NORMAL": f'r = await {T("id=21")}\nr["value"]',
        "R1A": 'leftover = "A-secret"\n"set"',
        "R1B": 'try:\n    x = leftover\nexcept NameError:\n    x = "gone"\nx',
        "R1cA": f'leftC = "A-secret"\nawait {T("id=1")}\nawait {T("id=2")}\n"A done"',
        "R1cB": 'try:\n    x = leftC\nexcept NameError:\n    x = "gone"\nx',
        "R2a": f'r = await {T("id=1")}\nres = [type(r).__name__]\nfor expr in ["r.__class__.__mro__", "type(r).__subclasses__", "r.__class__.__base__.__subclasses__()"]:\n    try:\n        res.append(str(eval(expr))[:200])\n    except Exception as e:\n        res.append("threw " + type(e).__name__ + ": " + str(e)[:100])\nres',
        "R2b": f'try:\n    await {F("")}\n    o = "no throw"\nexcept Exception as e:\n    o = [type(e).__name__, str(e)[:500], repr(e)[:500]]\no',
        "R2c": f'r = await {R("")}\n[type(r).__name__, str(r)[:500]]',
        "R3": 'def f(n):\n    return f(n + 1) + 1\ntry:\n    o = f(0)\nexcept BaseException as e:\n    o = type(e).__name__ + ": " + str(e)[:200]\no',
        "R3deep": "root = []\nx = root\nfor i in range(100000):\n    y = []\n    x.append(y)\n    x = y\nroot",
        "ALIVE": '"alive"',
        "R4": 'import re\nm = re.match(r"^(a+)+$", "a" * 40 + "b")\nstr(m)',
        "R5": f'import asyncio\nrs = await asyncio.gather(*[{T("id=i")} for i in range(2000)])\nlen(rs)',
        "R6": f'await {T("id=1")}\nwhile True:\n    pass',
        "R7a": 'import asyncio\nawait asyncio.sleep(100000)\n"resolved?"',
        "R7b": f'import asyncio\nfs = [{T("id=i")} for i in range(5)]\nwhile True:\n    pass',
        "R8a": 'print("x" * (20 * 1024 * 1024))\n"done"',
        "R8b": '"y" * (20 * 1024 * 1024)',
    }


async def neighbor(a, c, aggressor, n=1):
    if aggressor is None:
        return {"notApplicable": True}
    aggs = [asyncio.ensure_future(timed(a, aggressor, f"aggressor{i}")) for i in range(n)]
    await asyncio.sleep(0.15)
    b = await timed(a, c["NORMAL"], "B(+150ms)")
    await asyncio.sleep(max(0, 1.0 - now() / 1000))
    cc = await timed(a, c["NORMAL"], "C(+1s)")
    done = await asyncio.gather(*aggs)
    after = await timed(a, c["NORMAL"], "after")
    return {"aggressors": done, "b": b, "c": cc, "after": after}


async def main():
    lagt = asyncio.ensure_future(lag_monitor())
    record = {"config": config, "test": test_id}
    try:
        a = await ad.make(config, host)
        record["impl"], record["notes"] = a.name, getattr(a, "notes", None)
        c = js_codes(a) if a.lang == "js" else py_codes(a)
        # Optional: an adapter whose guest needs different code for the same intent (sync-only Python, Starlark)
        # overrides entries; a value of None marks the test not applicable.
        if hasattr(a, "override_codes"):
            c.update(a.override_codes(c))
        tests = {
            "R1": lambda: seq([("A", c["R1A"]), ("B", c["R1B"])]),
            "R1c": lambda: r1c(),
            "R2a": lambda: timed(a, c["R2a"]),
            "R2b": lambda: timed(a, c["R2b"]),
            "R2c": lambda: timed(a, c["R2c"]),
            "R3": lambda: seq([("recursion", c["R3"]), ("deep-return", c["R3deep"]), ("after", c["ALIVE"])]),
            "R4": lambda: timed(a, c["R4"]),
            "R5": lambda: r5(),
            "R6": lambda: timed(a, c["R6"]),
            "R7a": lambda: timed(a, c["R7a"]),
            "R7b": lambda: r7b(),
            "R8a": lambda: timed(a, c["R8a"]),
            "R8b": lambda: timed(a, c["R8b"]),
            "R9a": lambda: neighbor(a, c, c["LOOP"]),
            "R9b": lambda: neighbor(a, c, c["BOMB"]),
            "R9c": lambda: neighbor(a, c, c["FLOOD"]),
            "R9d": lambda: neighbor(a, c, c["REGEX"]),
            "R9e": lambda: neighbor(a, c, c["LOOP"], 8),
        }

        async def seq(steps):
            return {label: await timed(a, code, label) for label, code in steps}

        async def r1c():
            pa = asyncio.ensure_future(timed(a, c["R1cA"], "A"))
            await asyncio.sleep(0.1)
            b = await timed(a, c["R1cB"], "B(concurrent)")
            return {"A": await pa, "B": b}

        async def r5():
            r = await timed(a, c["R5"])
            at = dict(state)
            await asyncio.sleep(3)
            return {"r": r, "atReturn": at, "after3s": dict(state)}

        async def r7b():
            r = await timed(a, c["R7b"])
            at = dict(state)
            await asyncio.sleep(1.5)
            after = await timed(a, c["NORMAL"], "after")
            return {"r": r, "atReturn": at, "after1500ms": dict(state), "after": after}

        record["data"] = await tests[test_id]()
    except BaseException:  # noqa: BLE001
        record["harnessError"] = traceback.format_exc()[-3000:]
    if "a" in dir() and hasattr(a, "stats"):
        try:
            record["adapterStats"] = await a.stats()
        except BaseException as e:  # noqa: BLE001
            record["adapterStats"] = {"error": repr(e)}
    record["hostMaxEventLoopLagMs"] = round(max_lag)
    record["totalMs"] = now()
    rec_text = json.dumps(record, default=repr)
    if os.environ.get("RECORD_FILE"):
        with open(os.environ["RECORD_FILE"], "w") as f:
            f.write(rec_text)
        rec_text = '"in RECORD_FILE"'
    print("@@RECORD@@" + rec_text, flush=True)
    lagt.cancel()
    os._exit(0)


asyncio.new_event_loop().run_until_complete(main())
