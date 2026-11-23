#!/usr/bin/env python3
"""SPEC probes for mcp-run-python 0.0.22 (pydantic/mcp-run-python @ 4f93a92, archived), Pyodide in Deno.

Run with the impl venv interpreter:
    ../../impls/mcp-run-python/.venv/bin/python run_probes.py            # all probes
    ../../impls/mcp-run-python/.venv/bin/python run_probes.py P4 P12     # some probes

Entry point: the public `async_prepare_deno_env` helper, which is what `code_sandbox`
uses. It starts `deno run --allow-net --allow-read=./node_modules ... src/main.ts stdio`
and the probe talks to it over the MCP stdio transport with the `run_python_code` tool.

Each probe runs in a child process (this file with --child <id>). The parent kills the
child's process group at 120 s for P6 and P7 (other probes get 900 s). P7 is also killed
at 4 GiB summed RSS of the process tree.
"""

import asyncio
import json
import os
import signal
import statistics
import subprocess
import sys
import time
import traceback
from contextlib import asynccontextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
VENV_PY = os.path.normpath(os.path.join(HERE, "..", "..", "impls", "mcp-run-python", ".venv", "bin", "python"))
ALL = [f"P{i}" for i in range(1, 13)]
TIMEOUT_S = {"P6": 120, "P7": 120, "P7b": 120, "P11": 900}
DEFAULT_TIMEOUT_S = 300
RSS_CAP_KB = 4 * 1024 * 1024
SECRET = "s3cr3t"


def write_txt(pid, lines):
    with open(os.path.join(OUT, f"{pid}.txt"), "w") as f:
        f.write("\n".join(str(x) for x in lines) + "\n")


@asynccontextmanager
async def sandbox(*, allow_networking=True, with_env=False):
    """One deno + Pyodide MCP server. with_env passes the full host environment to deno."""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from mcp_run_python import async_prepare_deno_env

    async with async_prepare_deno_env("stdio", return_mode="json", allow_networking=allow_networking) as deno_env:
        env = dict(os.environ) if with_env else None
        params = StdioServerParameters(command="deno", args=deno_env.args, cwd=deno_env.cwd, env=env)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


async def ev(session, code, globals_=None):
    args = {"python_code": code}
    if globals_ is not None:
        args["global_variables"] = globals_
    result = await session.call_tool("run_python_code", args)
    text = result.content[0].text
    return json.loads(text)


def errtext(r):
    return (r.get("error") or "").strip().splitlines()[-1] if r.get("error") else ""


async def probe_p1():
    async with sandbox() as s:
        tools = await s.list_tools()
        names = [t.name for t in tools.tools]
        schema = {t.name: t.input_schema for t in tools.tools}
    write_txt("P1", ["tools/list names:", names, "inputSchema:", json.dumps(schema, indent=1),
                     "Host functions: none can be registered. global_variables is a JSON map (pyodide.toPy), so a callable cannot be passed."])
    return "not-applicable", (
        f"server exposes only {names}; run_python_code takes python_code and JSON global_variables, "
        f"so no host function named lookup can be registered (not-applicable: no host tool bridge)"
    )


async def probe_p2():
    async with sandbox() as s:
        r = await ev(s, 'print("A" * 200000)\n"RETURNED"')
    out = r.get("output", [])
    text = "".join(out)
    total = len(text)
    a_count = text.count("A")
    trunc = any("trunc" in x.lower() for x in out)
    ok = r.get("status") == "success" and r.get("return_value") == "RETURNED"
    detail = (f"return_value {r.get('return_value')!r} came back; output array had {len(out)} entries, "
              f"{total} chars, {a_count} 'A', truncation marker {trunc}; both channels returned")
    write_txt("P2", ["CODE: print('A'*200000) then 'RETURNED'", f"STATUS: {r.get('status')}",
                     f"RETURN: {r.get('return_value')!r}", f"OUTPUT_ENTRIES: {len(out)}", f"CHARS: {total}",
                     f"A_COUNT: {a_count}", f"TRUNCATION_MARKER: {trunc}"])
    return ("works" if ok else "error"), detail


async def probe_p3():
    url = "https://example.com"
    async with sandbox() as s:
        r_py = await ev(s, f'import urllib.request\nurllib.request.urlopen("{url}")')
        r_js = await ev(s, f'import js\nr = await js.fetch("{url}")\n[r.status, len(await r.text())]')
    async with sandbox(allow_networking=False) as s2:
        r_nonet = await ev(s2, f'import js\nr = await js.fetch("{url}")\n[r.status, len(await r.text())]')
    js_ok = r_js.get("status") == "success"
    detail = (
        f"python urllib: {errtext(r_py) or 'returned ' + repr(r_py.get('return_value'))}; "
        f"js.fetch with default allow_networking=True: status={r_js.get('status')} return={r_js.get('return_value')}; "
        f"js.fetch with allow_networking=False: {errtext(r_nonet) or r_nonet.get('return_value')}"
    )
    write_txt("P3", [f"urllib: {json.dumps(r_py)}", f"js.fetch default: {json.dumps(r_js)}",
                     f"js.fetch allow_networking=False: {json.dumps(r_nonet)}"])
    return ("works" if js_ok else "blocked"), detail


async def probe_p4():
    async with sandbox() as s:
        r_py = await ev(s, 'open("/etc/hosts").read()')
        r_deno = await ev(s, 'import js\njs.Deno.readTextFileSync("/etc/hosts")')
        r_cwd = await ev(s, 'import js\n[js.Deno.cwd(), [e.name for e in js.Deno.readDirSync("node_modules")][:5]]')
        r_w = await ev(s, 'import js\njs.Deno.writeTextFileSync("probe-write.txt", "x")')
        r_mem = await ev(s, 'open("/tmp/probe-mem.txt", "w").write("x")\nopen("/tmp/probe-mem.txt").read()')
    detail = (
        f"python open('/etc/hosts'): {errtext(r_py)}; "
        f"js Deno.readTextFileSync('/etc/hosts'): {errtext(r_deno)}; "
        f"Deno readDirSync('node_modules') inside --allow-read: {r_cwd.get('status')} {r_cwd.get('return_value')}; "
        f"Deno write in cwd: {errtext(r_w) or 'wrote'}; Pyodide in-memory /tmp write+read: {r_mem.get('status')} {r_mem.get('return_value')}"
    )
    write_txt("P4", ["python open:", json.dumps(r_py), "Deno.readTextFileSync /etc/hosts:", json.dumps(r_deno),
                     "Deno cwd/readDir:", json.dumps(r_cwd), "Deno write cwd:", json.dumps(r_w),
                     "Pyodide MEMFS /tmp:", json.dumps(r_mem)])
    blocked_host = "NotCapable" in (r_deno.get("error") or "") and "FileNotFound" in (r_py.get("error") or "")
    outcome = "blocked" if blocked_host else "works"
    return outcome, detail


async def probe_p5():
    os.environ["PROBE_SECRET"] = SECRET
    codes = {
        "python os.environ.get": 'import os\nos.environ.get("PROBE_SECRET")',
        "js process.env": 'import js\njs.eval("process.env.PROBE_SECRET")',
        "Deno.env.get": 'import js\njs.Deno.env.get("PROBE_SECRET")',
    }
    rows = {}
    for label, with_env in [("default MCP env (secret not forwarded to deno)", False),
                            ("full host env forwarded to deno", True)]:
        async with sandbox(with_env=with_env) as s:
            rows[label] = {k: await ev(s, c) for k, c in codes.items()}
    lines = []
    seen = []
    for cfg, res in rows.items():
        for k, r in res.items():
            v = r.get("return_value")
            e = errtext(r)
            lines.append(f"{cfg} | {k}: return={v!r} error={e!r}")
            if v == SECRET:
                seen.append(f"{cfg}/{k}")
    write_txt("P5", lines)
    outcome = "works" if seen else "blocked"
    detail = ("secret visible via " + ", ".join(seen)) if seen else (
        "secret not visible in either config: os.environ empty, process.env stubbed to {}, "
        "Deno.env.get raises NotCapable (no --allow-env) even when the full host env is forwarded")
    return outcome, detail


async def probe_p6():
    async with sandbox() as s:
        r = await ev(s, "while True:\n    pass")
    return ("limited" if r.get("status") != "success" else "works"), json.dumps(r)


async def probe_p7():
    code = 'a = []\nwhile True:\n    a.append("x" * 10**6)'
    async with sandbox() as s:
        try:
            r = await ev(s, code)
            detail = json.dumps(r)[:600]
            outcome = "limited" if r.get("status") != "success" else "works"
        except Exception as e:  # noqa: BLE001 - server process died
            outcome = "limited"
            detail = f"MCP call raised {type(e).__name__}: {str(e)[:300]}"
    write_txt("P7", ["CODE: a=[]; while True: a.append('x'*10**6)", f"OUTCOME: {outcome}", detail])
    return outcome, detail


async def probe_p7b():
    """P7 variant for the README claim that Deno has no memory limit: allocate on the V8 side via js.eval."""
    code = "import js\njs.eval(\"(function(){ var a = []; while (true) { a.push('x'.repeat(1000000)); } })()\")"
    async with sandbox() as s:
        try:
            r = await ev(s, code)
            detail = json.dumps(r)[:400]
            outcome = "limited" if r.get("status") != "success" else "works"
        except Exception as e:  # noqa: BLE001 - deno process died
            outcome = "limited"
            detail = f"MCP call raised {type(e).__name__}: {str(e)[:300]}"
    write_txt("P7b", ["CODE: js.eval a loop pushing 1 MB strings on the V8 side", f"OUTCOME: {outcome}", detail])
    return outcome, detail


async def probe_p8():
    async with sandbox() as s:
        await ev(s, "kept = 7")
        r_same = await ev(s, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
        await ev(s, "import sys\nsys.probe_kept = 7")
        r_sys = await ev(s, "import sys\nprint(getattr(sys, 'probe_kept', 'absent'))")
        await ev(s, 'import js\njs.eval("globalThis.probeJs = 9")')
        r_js = await ev(s, 'import js\nprint(js.eval("globalThis.probeJs"))')
        await ev(s, 'import js\njs.eval("Array.prototype.probeTaint = 42")')
        r_taint = await ev(s, 'import js\nprint(js.eval("[].probeTaint"))')
    async with sandbox() as s2:
        r_new = await ev(s2, "try:\n    print(kept)\nexcept NameError:\n    print('gone')")
        r_new_sys = await ev(s2, "import sys\nprint(getattr(sys, 'probe_kept', 'absent'))")
    py_state = "".join(r_same.get("output", [])).strip()
    outcome = "persists" if py_state == "7" else "fresh"
    detail = (
        f"Python global kept: same server {py_state!r}, new server {''.join(r_new.get('output', [])).strip()!r}; "
        f"sys attribute survives in same server {''.join(r_sys.get('output', [])).strip()!r}, new server {''.join(r_new_sys.get('output', [])).strip()!r}; "
        f"JS global set in run 1 read in run 2 {''.join(r_js.get('output', [])).strip()!r}; "
        f"Array.prototype taint read in run 2 {''.join(r_taint.get('output', [])).strip()!r}"
    )
    write_txt("P8", [detail])
    return outcome, detail


async def probe_p9():
    async with sandbox() as s:
        r = await ev(s, "import asyncio, time\nt = time.time()\n"
                        "await asyncio.gather(*[asyncio.sleep(0.2) for _ in range(5)])\n"
                        "round((time.time() - t) * 1000)")
    ms = r.get("return_value")
    detail = (f"no host tool exists, so host-call parallelism is not-applicable (see P1). "
              f"Extra, in-sandbox asyncio.gather of five 200 ms sleeps took {ms} ms return")
    write_txt("P9", ["host tool calls: not-applicable (see P1)", f"in-sandbox gather of 5 x sleep(0.2): {ms} ms"])
    return "not-applicable", detail


async def probe_p10():
    async with sandbox() as s:
        r = await ev(s, 'raise ValueError("probe-boom")')
    err = r.get("error", "")
    has_line = "line 1" in err
    write_txt("P10", ["CODE: raise ValueError('probe-boom')", f"STATUS: {r.get('status')}", "ERROR:", err])
    detail = f"status {r.get('status')}; error text {err.strip()!r}; line number survives: {has_line}"
    return ("works" if r.get("status") == "run-error" and "probe-boom" in err else "error"), detail


async def probe_p11():
    t0 = time.perf_counter()
    cold = []
    setup_ms = None
    for i in range(20):
        t = time.perf_counter()
        async with sandbox() as s:
            enter = (time.perf_counter() - t) * 1000
            r = await ev(s, "print(2)")
            total = (time.perf_counter() - t) * 1000
        if setup_ms is None:
            setup_ms = enter
        cold.append(total)
        assert r.get("status") == "success", r
    warm = []
    async with sandbox() as s:
        await ev(s, "1 + 1")
        for _ in range(20):
            t = time.perf_counter()
            r = await ev(s, "1 + 1")
            warm.append((time.perf_counter() - t) * 1000)
            assert r.get("status") == "success" and r.get("return_value") == 2, r

    def stats(xs):
        xs = sorted(xs)
        return statistics.median(xs), xs[min(len(xs) - 1, int(round(0.9 * (len(xs) - 1))))]

    cm, cp = stats(cold)
    wm, wp = stats(warm)
    write_txt("P11", ["COLD_FRESH_SERVER_MS:", ", ".join(f"{x:.1f}" for x in cold),
                      "WARM_EVAL_MS:", ", ".join(f"{x:.2f}" for x in warm),
                      f"FIRST_ENTER_MS: {setup_ms:.1f}", f"cold median {cm:.1f} p90 {cp:.1f}",
                      f"warm median {wm:.2f} p90 {wp:.2f}"])
    detail = (f"fresh server per run (deno start + Pyodide load + eval): median {cm:.0f} ms, p90 {cp:.0f} ms (n=20); "
              f"warm eval in one server: median {wm:.2f} ms, p90 {wp:.2f} ms (n=20); "
              f"first enter (deno dep prepare + server start) {setup_ms:.0f} ms; total {time.perf_counter()-t0:.0f} s")
    return "works", detail


RUN_COMMAND_CODE = '''import js
js.eval("""(function () {
  try {
    var D = this.constructor.constructor('return Deno')();
    var o = new D.Command('echo', {args: ['PWNED']}).outputSync();
    return 'ran: ' + new TextDecoder().decode(o.stdout);
  } catch (e) {
    return 'raised: ' + String(e).slice(0, 300);
  }
})()""")
'''


async def probe_p12():
    rows = []
    async with sandbox() as s:
        r_eval = await ev(s, 'import js\njs.eval("1 + 2")')
        rows.append(("js.eval arbitrary JS", r_eval))
        r_proc = await ev(s, 'import js\njs.eval("this.constructor.constructor(\'return process\')()").pid')
        rows.append(("spec: this.constructor.constructor('return process')()", r_proc))
        r_deno = await ev(s, 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\nstr(d.version.deno)')
        rows.append(("host runtime Deno object reached, version", r_deno))
        r_read = await ev(s, 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\nd.readTextFileSync("/etc/hosts")')
        rows.append(("Deno.readTextFileSync /etc/hosts", r_read))
        r_run = await ev(s, RUN_COMMAND_CODE)
        rows.append(("Deno.Command echo PWNED", r_run))
        r_write = await ev(s, 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\nd.writeTextFileSync("/tmp/probe-escape.txt", "x")')
        rows.append(("Deno.writeTextFileSync /tmp", r_write))
    async with sandbox(with_env=True) as s_env:
        r_env = await ev(s_env, 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\nd.env.get("PROBE_SECRET")')
        rows.append(("Deno.env.get with full host env forwarded", r_env))
    lines = []
    for label, r in rows:
        v = r.get("return_value")
        e = errtext(r)
        lines.append(f"{label}: status={r.get('status')} return={v!r} error={e!r} output={r.get('output')!r}")
    write_txt("P12", lines)
    reached = any(l for l in lines if "host runtime Deno object" in l and "status=success" in l)
    outcome = "escaped" if reached else "blocked"
    detail = " | ".join(lines)
    return outcome, detail


PROBES = {
    "P1": probe_p1, "P2": probe_p2, "P3": probe_p3, "P4": probe_p4, "P5": probe_p5, "P6": probe_p6,
    "P7": probe_p7, "P7b": probe_p7b, "P8": probe_p8, "P9": probe_p9, "P10": probe_p10, "P11": probe_p11, "P12": probe_p12,
}


def child_main(pid):
    try:
        outcome, detail = asyncio.run(PROBES[pid]())
        status = {"id": pid, "outcome": outcome, "detail": detail, "error": None}
    except Exception:  # noqa: BLE001
        status = {"id": pid, "outcome": "error", "detail": "", "error": traceback.format_exc()}
    with open(os.path.join(OUT, f"{pid}.json"), "w") as f:
        json.dump(status, f)


def tree_rss_kb(root_pid):
    ps = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    children, rss = {}, {}
    for line in ps.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        pid, ppid, r = (int(x) for x in parts)
        children.setdefault(ppid, []).append(pid)
        rss[pid] = r
    total, stack = 0, [root_pid]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(children.get(p, []))
    return total


def parent_run(pid):
    json_path = os.path.join(OUT, f"{pid}.json")
    if os.path.exists(json_path):
        os.remove(json_path)
    limit = TIMEOUT_S.get(pid, DEFAULT_TIMEOUT_S)
    log = open(os.path.join(OUT, f"{pid}.stdout.log"), "w")
    proc = subprocess.Popen([VENV_PY, os.path.abspath(__file__), "--child", pid],
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    start = time.monotonic()
    peak_kb, last_sample, killed = 0, 0.0, None
    while proc.poll() is None:
        elapsed = time.monotonic() - start
        if elapsed > limit:
            killed = "wall"
            break
        if pid in ("P7", "P7b") and elapsed - last_sample >= 0.25:
            last_sample = elapsed
            kb = tree_rss_kb(proc.pid)
            peak_kb = max(peak_kb, kb)
            if kb > RSS_CAP_KB:
                killed = "rss"
                break
        time.sleep(0.05)
    elapsed = time.monotonic() - start
    if killed:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    log.close()
    if killed == "wall":
        result = {"id": pid, "outcome": "no-limit-within-120s" if pid in ("P6", "P7") else "error",
                  "detail": f"harness stopped the run at {elapsed:.0f} s wall; no limit fired inside the sandbox"}
        if pid == "P6":
            write_txt("P6", ["CODE: while True: pass", "OUTCOME: no-limit-within-120s", result["detail"]])
    elif killed == "rss":
        result = {"id": pid, "outcome": "no-limit-within-120s",
                  "detail": f"no sandbox limit fired; harness killed the tree after the first sample over 4 GiB "
                            f"({peak_kb/1024/1024:.2f} GiB) at {elapsed:.1f} s"}
        write_txt("P7", ["CODE: a=[]; while True: a.append('x'*10**6)", f"OUTCOME: {result['outcome']}", result["detail"]])
    else:
        with open(json_path) as f:
            result = json.load(f)
        if pid == "P7":
            result["detail"] += f" | run ended after {elapsed:.1f} s, sampled peak tree RSS {peak_kb/1024/1024:.2f} GiB"
        if pid == "P6" and result.get("outcome") == "limited":
            pass
    if result.get("error"):
        result["detail"] = (result.get("detail") or "") + " | " + result["error"].splitlines()[-1]
    return result


def main(argv):
    if len(argv) >= 3 and argv[1] == "--child":
        child_main(argv[2])
        return 0
    os.makedirs(OUT, exist_ok=True)
    wanted = argv[1:] or ALL
    summary = {}
    for pid in wanted:
        t = time.monotonic()
        res = parent_run(pid)
        summary[pid] = res
        print(f"{pid}\t{res['outcome']}\t{res['detail']}\t(harness {time.monotonic() - t:.1f} s)", flush=True)
    with open(os.path.join(OUT, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
