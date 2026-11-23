"""Hardened rerun of the SPEC probes against Codex's shipped code-mode host (V8), no model.

Same framed-JSON stdio protocol as run_codemode_probes.py, but every session is opened with the
strictest public knobs the protocol exposes: session/open cellExecutionLimits
{maxYieldTimeMs, maxHeapSizeBytes} (code-mode-protocol/src/host/payload.rs:26-31) and per-execute
yield_time_ms / max_output_tokens (payload.rs:205-211). Output goes to out/codemode/hardened-P*.txt.
"""
import json
import os
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST = Path(os.environ.get(
    "CODEX_CODE_MODE_HOST",
    Path.home() / ".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex-code-mode-host"))
OUT = HERE / "out" / "codemode"
KILL_SECONDS = 120
KILL_RSS_KB = 4 * 1024 * 1024
CAPABILITIES = ["session-cell-execution-resource-limits", "yield-observation", "bounded-output-v1", "delegate-capacity-4096"]
HEAP_LIMIT_BYTES = 64 * 1024 * 1024
YIELD_MS = 1000
LIMITS = {"maxYieldTimeMs": YIELD_MS, "maxHeapSizeBytes": HEAP_LIMIT_BYTES}
MAX_OUTPUT_TOKENS = 1000
LOOKUP = {
    "name": "lookup", "tool_name": {"name": "lookup", "namespace": None},
    "description": "Wait 200 ms, then return {id, value: id * 2}.", "kind": "function",
    "input_schema": {"type": "object", "properties": {"id": {"type": "number"}}, "required": ["id"]},
    "output_schema": None,
}
TRIVIAL = 'text("alive " + String(1 + 1));'

PROBES = {
    "P1": ['const r = await tools.lookup({id: 21}); text(String(r.value));'],
    "P3": ['await fetch("https://example.com");'],
    "P4": ['const fs = await import("fs"); text(fs.readFileSync("/etc/hosts", "utf8"));',
           'text(require("fs").readFileSync("/etc/hosts", "utf8"));',
           'text(await Deno.readTextFile("/etc/hosts"));'],
    "P5": ['text(String(process.env.PROBE_SECRET));'],
    "P6": ['while (true) {}'],
    "P7": ['const a = []; while (true) a.push("x".repeat(1e6) + a.length);'],
    "P9": ['const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id: i}))); text(String(Date.now() - t));'],
    "P12": ['text(String(this.constructor.constructor("return typeof process")()));',
            'text(String(globalThis.constructor.constructor("return typeof process")()));',
            'text(String(Function("return this")().process));',
            'text(String((function(){return this})().process));',
            'text(JSON.stringify(Object.getOwnPropertyNames(globalThis).filter(n => !/^[A-Z]/.test(n))));'],
}


class Host:
    def __init__(self, stderr_path):
        env = dict(os.environ, PROBE_SECRET="s3cr3t")
        self.stderr = open(stderr_path, "wb")
        self.proc = subprocess.Popen([str(HOST)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=self.stderr, env=env, start_new_session=True)
        print(f"  spawned code-mode host pid {self.proc.pid} (own process group)", flush=True)
        self.lock = threading.Lock()
        self.calls = 0
        self.next_id = 0

    def send(self, message):
        payload = json.dumps(message).encode()
        with self.lock:
            try:
                self.proc.stdin.write(struct.pack("<I", len(payload)) + payload)
                self.proc.stdin.flush()
            except (BrokenPipeError, OSError) as error:
                return repr(error)
        return None

    def recv(self):
        header = self.proc.stdout.read(4)
        if len(header) < 4:
            return None
        (length,) = struct.unpack("<I", header)
        return json.loads(self.proc.stdout.read(length))

    def request(self, request):
        self.next_id += 1
        error = self.send({"type": "operation/request", "id": self.next_id, "request": request})
        return self.next_id, error

    def answer_tool(self, message):
        def respond():
            time.sleep(0.2)
            args = message["request"]["invocation"].get("input") or {}
            result = {"id": args.get("id"), "value": args.get("id") * 2}
            self.send({"type": "delegate/response", "id": message["id"],
                       "result": {"status": "ok", "value": {"type": "tool/result", "result": result}}})
        self.calls += 1
        threading.Thread(target=respond, daemon=True).start()

    def until(self, predicate):
        while True:
            message = self.recv()
            if message is None:
                return None
            if message["type"] == "delegate/request" and message["request"]["type"] == "tool/invoke":
                self.answer_tool(message)
            elif predicate(message):
                return message

    def handshake(self):
        self.send({"type": "connection/hello", "supportedVersions": [1],
                   "requiredCapabilities": [], "optionalCapabilities": CAPABILITIES})
        return self.recv()

    def open(self, session):
        rid, error = self.request({"method": "session/open", "sessionId": session, "outputTruncation": "server",
                                   "cellExecutionLimits": LIMITS})
        return error or self.until(lambda m: m.get("id") == rid)

    def execute(self, session, source, index):
        calls_before = self.calls
        start = time.monotonic()
        rid, error = self.request({"method": "session/execute", "sessionId": session, "request": {
            "tool_call_id": f"call-{index}", "enabled_tools": [LOOKUP], "source": source,
            "yield_time_ms": YIELD_MS, "max_output_tokens": MAX_OUTPUT_TOKENS}})
        message = error or self.until(lambda m: m["type"] == "execute/initialResponse" and m["id"] == rid)
        return {"source": source, "elapsed_ms": round((time.monotonic() - start) * 1000, 2),
                "host_calls": self.calls - calls_before, "response": message}

    def wait(self, session, cell_id):
        rid, error = self.request({"method": "session/wait", "sessionId": session,
                                   "request": {"cell_id": cell_id, "yield_time_ms": YIELD_MS}})
        return error or self.until(lambda m: m["type"] == "operation/response" and m["id"] == rid)

    def terminate(self, session, cell_id):
        rid, error = self.request({"method": "session/terminate", "sessionId": session, "cellId": cell_id})
        return error or self.until(lambda m: m["type"] == "operation/response" and m["id"] == rid)


def rss_kb(pid):
    r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def yielded_cell(record):
    value = ((record["response"] or {}).get("result") or {}).get("value") or {} if isinstance(record["response"], dict) else {}
    return (value.get("Yielded") or {}).get("cell_id")


def run_probe(probe, terminate_after_first_yield=False):
    t0 = time.monotonic()
    host = Host(OUT / f"hardened-{probe}.stderr.txt")
    peak, killed, done = [0], [None], threading.Event()

    def watchdog():
        while not done.is_set() and host.proc.poll() is None:
            peak[0] = max(peak[0], rss_kb(host.proc.pid))
            elapsed = time.monotonic() - t0
            if peak[0] >= KILL_RSS_KB or elapsed >= KILL_SECONDS:
                killed[0] = (f"killed by harness at {peak[0] / 1024:.0f} MB RSS after {elapsed:.1f}s"
                             if peak[0] >= KILL_RSS_KB else f"killed by harness at {KILL_SECONDS}s (no-limit-within-120s)")
                os.killpg(host.proc.pid, 9)
                return
            time.sleep(0.05)
    threading.Thread(target=watchdog, daemon=True).start()
    hello = host.handshake()
    opened = host.open("s1")
    records = []
    for index, source in enumerate(PROBES[probe]):
        record = host.execute("s1", source, index)
        cell_id, waits = yielded_cell(record), []
        if cell_id and terminate_after_first_yield:
            waits.append({"t_ms": round((time.monotonic() - t0) * 1000), "terminate": host.terminate("s1", cell_id)})
            cell_id = None
        while cell_id and not killed[0]:
            reply = host.wait("s1", cell_id)
            waits.append({"t_ms": round((time.monotonic() - t0) * 1000), "reply": reply})
            outcome = (((reply or {}).get("result") or {}).get("value") or {}).get("outcome") or {} if isinstance(reply, dict) else {}
            cell_id = ((outcome.get("LiveCell") or {}).get("Yielded") or {}).get("cell_id")
        record["waits"] = waits
        records.append(record)
    after = {"host_alive_before": host.proc.poll() is None}
    if probe in ("P6", "P7") and not killed[0]:
        after["same_session_trivial"] = host.execute("s1", TRIVIAL, 90)
        after["second_session_open"] = host.open("s2")
        after["second_session_trivial"] = host.execute("s2", TRIVIAL, 91)
    after["host_alive_after"] = host.proc.poll() is None
    after["host_returncode"] = host.proc.poll()
    done.set()
    wall = (time.monotonic() - t0) * 1000
    if host.proc.poll() is None:
        os.killpg(host.proc.pid, 9)
    host.proc.wait()
    return {"probe": probe, "host": str(HOST), "limits_sent": LIMITS, "max_output_tokens": MAX_OUTPUT_TOKENS,
            "hello": hello, "session_open": opened, "wall_ms": round(wall, 1), "peak_rss_mb": round(peak[0] / 1024, 1),
            "killed": killed[0], "records": records, "after": after}


def clip(value):
    text = json.dumps(value)
    return text if len(text) <= 1500 else f"{text[:600]} ...[{len(text) - 1200} chars elided by harness]... {text[-600:]}"


def main(selected):
    OUT.mkdir(parents=True, exist_ok=True)
    for name in selected:
        probe, terminate = (name[:-len("-terminate")], True) if name.endswith("-terminate") else (name, False)
        result = run_probe(probe, terminate)
        (OUT / f"hardened-{name}.json").write_text(json.dumps(result, indent=1))
        lines = [f"probe: {name} (codex code-mode host, V8, hardened)", f"host: {HOST.name} codex 0.169.0",
                 f"session/open cellExecutionLimits sent: {json.dumps(LIMITS)}",
                 f"session/execute yield_time_ms={YIELD_MS} max_output_tokens={MAX_OUTPUT_TOKENS}",
                 f"handshake: {json.dumps(result['hello'])}", f"session/open reply: {json.dumps(result['session_open'])}",
                 f"wall_ms: {result['wall_ms']}", f"peak_rss_mb: {result['peak_rss_mb']}", f"killed: {result['killed']}"]
        for i, r in enumerate(result["records"]):
            lines += ["", f"--- execution {i} ---", "source:", r["source"], f"elapsed_ms: {r['elapsed_ms']}",
                      f"host_calls: {r['host_calls']}", "initial response:", clip(r["response"])]
            for w in r["waits"][:3] + (["..."] if len(r["waits"]) > 6 else []) + r["waits"][max(3, len(r["waits"]) - 3):]:
                lines.append(w if w == "..." else f"{'terminate' if 'terminate' in w else 'wait'} at t={w['t_ms']}ms: "
                             f"{clip(w.get('terminate', w.get('reply')))}")
            lines.append(f"total waits/terminates: {len(r['waits'])}")
        lines += ["", "--- after the probe ---"] + [f"{k}: {clip(v)}" for k, v in result["after"].items()]
        stderr_tail = (OUT / f"hardened-{probe}.stderr.txt").read_text(errors="replace")[-1500:]
        lines += ["", "--- host stderr (tail) ---", stderr_tail]
        (OUT / f"hardened-{name}.txt").write_text("\n".join(lines) + "\n")
        print(f"{name}: wall={result['wall_ms']}ms killed={result['killed']} alive_after={result['after']['host_alive_after']} "
              f"first={clip(result['records'][0]['response'])[:300]}", flush=True)


main(sys.argv[1:] or ["P1", "P3", "P4", "P5", "P9", "P12"])
