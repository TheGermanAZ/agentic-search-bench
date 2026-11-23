"""SPEC probes for mcp-gway Code Mode (executeTool, Starlark), driven over the gateway's
own MCP endpoint (POST /mcp, JSON-RPC) the way an external MCP client calls it.

Raw JSON-RPC (stdlib urllib) instead of an MCP SDK client: executeTool failures come back as
JSON-RPC errors, and an SDK client would collapse them into an exception string. Saving the
full response body shows exactly what a model would get.

Usage: python3 -I probe.py <port> <gateway-pid> <out-prefix> <probe ids...>
"""
import json, os, subprocess, sys, threading, time, urllib.request, urllib.error

PORT, GW_PID, PREFIX, IDS = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4:]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
COUNT = os.path.join(OUT, "lookup-count.log")
CAP_S = 120
RSS_CAP_MB = 4096
URL = f"http://127.0.0.1:{PORT}/mcp"

INF = "def f():\n    for i in range(2147483647):\n        for j in range(2147483647):\n            pass\nf()"
MEM = ("def f():\n    a = []\n    for i in range(2147483647):\n        a.append(\"x\" * 1000000)\n"
       "    return len(a)\nresult = f()")

PROBES = {
    "P1": [ 'r = Probe.lookup(id=21)\nprint(r["value"])\nresult = r["value"]' ],
    "P2": [ 'print("A" * 200000)\n"RETURNED"', 'print("A" * 200000)\nresult = "RETURNED"',
            'result = "B" * 200000', 'print("A" * 60000)\nresult = "RETURNED"' ],
    "P3": [ 'r = urllib.request.urlopen("https://example.com")\nresult = r',
            'load("net", "http")\nresult = http.get("https://example.com")',
            'result = fetch("https://example.com")' ],
    "P4": [ 'result = open("/etc/hosts").read()',
            'result = read_file("/etc/hosts")',
            'f = getattr(Probe, "op" + "en", "no such attribute")\nresult = f' ],
    "P5": [ 'result = os.environ.get("PROBE_SECRET")',
            'result = environ.get("PROBE_SECRET")',
            'result = [dir(Probe), type(Probe), type(Probe.lookup), dir(Probe.lookup), type(print), dir(print)]' ],
    "P6": [ INF ],
    "P7": [ MEM ],
    "P8": [ 'kept = 7\nresult = "set"', 'result = kept' ],
    "P9": [ 'rs = [Probe.lookup(id=i) for i in [1, 2, 3, 4, 5]]\nresult = [r["value"] for r in rs]' ],
    "P10": [ 'fail("probe-boom")', 'x = 1\ny = 2\nfail("probe-boom")', 'x = 1\ny = {}\nz = y["missing"]',
             'result = Probe.lookup(id="not-a-number")' ],
    "P11": 'result = 1 + 1',
    "P12": [ 'result = ().__class__',
             'result = __import__("os").system("echo PWNED")',
             'result = [getattr(Probe.lookup, "_" + "_globals" + "_" + "_", "none"), getattr(print, "_" + "_self" + "_" + "_", "none"), getattr(Probe, "_" + "_class" + "_" + "_", "none")]',
             'result = [getattr(Probe.lookup, a, None) for a in ["func_globals", "f_globals", "gi_frame", "im_self", "cr_frame"]]',
             'p = print\nresult = p("PWNED-via-print-ref")' ],
}

def host_calls():
    try:
        with open(COUNT) as fh:
            return sum(1 for line in fh if line.strip())
    except FileNotFoundError:
        return 0

CONTAINER = os.environ.get("GW_CONTAINER")  # set when GW_PID is 0: the gateway runs in this container

def rss_mb(pid):
    if CONTAINER:
        try:
            out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", CONTAINER], capture_output=True, text=True, timeout=10).stdout.split("/")[0].strip()
            num = float("".join(ch for ch in out if ch.isdigit() or ch == "."))
            return round(num * (1024 if "GiB" in out else 1 / 1024 if "KiB" in out else 1))
        except Exception:
            return 0
    # macOS compresses and swaps memory, so RSS undercounts a runaway heap (default P7 showed
    # RSS 2.8 GB while phys_footprint was 56 GB). Use phys_footprint when `footprint` exists.
    try:
        out = subprocess.run(["footprint", str(pid)], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            if "phys_footprint:" in line and "peak" not in line:
                num, unit = line.split(":", 1)[1].split()[:2]
                return round(float(num) * {"KB": 1 / 1024, "MB": 1, "GB": 1024}.get(unit, 1))
    except Exception:
        pass
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        return round(int(out) / 1024) if out else 0
    except Exception:
        return 0

def alive(pid):
    if CONTAINER:
        r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}", CONTAINER], capture_output=True, text=True).stdout.strip()
        return r
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

_rid = [0]
def rpc(method, params, timeout=CAP_S):
    _rid[0] += 1
    body = json.dumps({"jsonrpc": "2.0", "id": _rid[0], "method": method, "params": params}).encode()
    req = urllib.request.Request(URL, data=body, headers={"content-type": "application/json", "accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def exec_code(code, watch_rss=False, extra_args=None):
    before = host_calls()
    peak, killed, stop = [0], [False], threading.Event()
    def sampler():
        while not stop.is_set():
            mb = rss_mb(GW_PID)
            peak[0] = max(peak[0], mb)
            if mb > RSS_CAP_MB and not killed[0]:
                killed[0] = True
                subprocess.run(["docker", "kill", CONTAINER]) if CONTAINER else os.kill(GW_PID, 9)
            stop.wait(0.25)
    th = threading.Thread(target=sampler, daemon=True)
    if watch_rss:
        th.start()
    t0 = time.perf_counter()
    rec = {}
    try:
        resp = rpc("tools/call", {"name": "executeTool", "arguments": {"code": code, **(extra_args or {})}})
        rec["ok"] = True
        if "error" in resp:
            rec["jsonrpcError"] = resp["error"]
        else:
            res = resp.get("result", {})
            rec["isError"] = bool(res.get("isError"))
            rec["text"] = "\n".join(c.get("text", json.dumps(c)) for c in res.get("content", []))
    except Exception as e:
        rec["ok"] = False
        rec["error"] = f"{type(e).__name__}: {e}"
    rec["ms"] = round((time.perf_counter() - t0) * 1000, 2)
    stop.set()
    if watch_rss:
        th.join()
        peak[0] = max(peak[0], rss_mb(GW_PID))
        rec["peakFootprintMB"] = peak[0]
        if killed[0]:
            rec["footprintKilled"] = True
    rec["hostCalls"] = host_calls() - before
    rec["gatewayAlive"] = alive(GW_PID)
    return rec

def save(pid, codes, recs, extra=None):
    lines = []
    for i, (c, r) in enumerate(zip(codes, recs), 1):
        lines.append(f"--- code {i} ---\n{c}\n--- result {i} ---")
        meta = {k: v for k, v in r.items() if k != "text"}
        lines.append(json.dumps(meta, ensure_ascii=False))
        t = r.get("text")
        if t is not None:
            shown = t if len(t) <= 4000 else t[:2000] + f"\n...[harness elided {len(t) - 4000} chars when saving]...\n" + t[-2000:]
            lines.append(f"text ({len(t)} chars):\n{shown}")
    if extra:
        lines.append("--- summary ---\n" + json.dumps(extra, ensure_ascii=False))
    with open(os.path.join(OUT, f"{PREFIX}{pid}.txt"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    brief = [{**{k: v for k, v in r.items() if k != "text"}, "textLen": len(r.get("text") or ""), "textHead": (r.get("text") or "")[:300]} for r in recs]
    print(pid, json.dumps({**(extra or {}), "results": brief}, ensure_ascii=False)[:3000], flush=True)

def concurrent_check(delay_s):
    """While a long probe runs, start an independent P1 on another connection after delay_s."""
    box = {}
    def go():
        time.sleep(delay_s)
        box["startedAtS"] = delay_s
        box["rec"] = exec_code('result = Probe.lookup(id=21)["value"]')
    th = threading.Thread(target=go, daemon=True)
    th.start()
    return th, box

t_setup = time.perf_counter()
init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "1"}})
tools = rpc("tools/list", {})
setup_ms = round((time.perf_counter() - t_setup) * 1000, 2)

for pid in IDS:
    if pid == "LIST":
        with open(os.path.join(OUT, f"{PREFIX}tools-list.json"), "w") as fh:
            json.dump({"initialize": init, "tools/list": tools}, fh, indent=2)
        print("LIST", [t["name"] for t in tools["result"]["tools"]])
        continue
    if pid == "P11":
        recs = [exec_code(PROBES["P11"]) for _ in range(20)]
        ms = sorted(r["ms"] for r in recs)
        save(pid, [PROBES["P11"]] * 20, recs, {"medianMs": (ms[9] + ms[10]) / 2, "p90Ms": ms[17], "setupMsInitializeAndList": setup_ms})
        continue
    if pid == "X1":  # cross-execution log leak: the sandbox object (and its _logs list) is shared
        codes = ['print("SECRET-FROM-A-1")\nr = Probe.lookup(id=1)\nprint("SECRET-FROM-A-2")\nr2 = Probe.lookup(id=2)\nprint("SECRET-FROM-A-3")\nresult = "A done"',
                 'r = Probe.lookup(id=3)\nresult = "B done"']
        out = [None, None]
        def run(i, delay):
            time.sleep(delay)
            out[i] = exec_code(codes[i])
        ths = [threading.Thread(target=run, args=(0, 0)), threading.Thread(target=run, args=(1, 0.15))]
        [t.start() for t in ths]; [t.join() for t in ths]
        save(pid, codes, out, {"note": "A and B are separate HTTP requests; B starts 150 ms after A. Look for SECRET-FROM-A in B's logs."})
        continue
    if pid == "X2":  # caller-supplied timeout: the code's caller (the model) chooses its own budget.
        # A tool-bound script (5 serial lookups, about 1.2 s) releases the GIL while it waits on tools,
        # so the sandbox timeout can fire; check when the response arrives and whether calls keep running.
        c = PROBES["P9"][0]
        recs = [exec_code(c, extra_args={"timeout": 0.5}), exec_code(c, extra_args={"timeout": 600})]
        save(pid, [c + "\n# executeTool arguments.timeout = 0.5", c + "\n# executeTool arguments.timeout = 600"], recs,
             {"note": "same script twice: per-call timeout 0.5 s, then 600 s chosen by the caller"})
        continue
    if pid == "X3":  # host-side callManyTool fan-out (not callable from Starlark), for P9 context
        before = host_calls(); t0 = time.perf_counter()
        resp = rpc("tools/call", {"name": "callManyTool", "arguments": {"calls": [{"server": "Probe", "tool": "lookup", "arguments": {"id": i}} for i in range(1, 6)]}})
        rec = {"ok": True, "ms": round((time.perf_counter() - t0) * 1000, 2), "hostCalls": host_calls() - before,
               "text": json.dumps(resp)}
        save(pid, ["callManyTool 5 x Probe.lookup"], [rec])
        continue
    code = PROBES[pid]
    codes = code if isinstance(code, list) else [code]
    recs = []
    for c in codes:
        conc = None
        if pid in ("P6", "P7"):
            conc = concurrent_check(5 if pid == "P6" else 1)
        r = exec_code(c, watch_rss=(pid in ("P6", "P7")))
        if conc:
            conc[0].join(timeout=CAP_S + 10)
            r["concurrentP1"] = conc[1].get("rec") and {k: v for k, v in conc[1]["rec"].items()}
            r["concurrentP1StartedAtS"] = conc[1].get("startedAtS")
        r["footprintAfterMB"] = rss_mb(GW_PID)
        recs.append(r)
        if not r.get("gatewayAlive", True):
            break
    save(pid, codes, recs)
