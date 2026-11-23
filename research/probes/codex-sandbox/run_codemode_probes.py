"""Drive Codex's shipped code-mode host (V8) over its framed-JSON stdio protocol, no model.

Wire format: codex-rs/code-mode-protocol/src/host/{codec.rs,message.rs}. Each frame is a u32
little-endian length followed by JSON. The client handshake and capabilities copy
codex-rs/code-mode/src/remote_session/connection.rs.
"""
import json
import os
import statistics
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
LOOKUP = {
    "name": "lookup", "tool_name": {"name": "lookup", "namespace": None},
    "description": "Wait 200 ms, then return {id, value: id * 2}.", "kind": "function",
    "input_schema": {"type": "object", "properties": {"id": {"type": "number"}}, "required": ["id"]},
    "output_schema": None,
}

PROBES = {
    "P1": ['const r = await tools.lookup({id: 21}); text(String(r.value));'],
    "P2": ['text("A".repeat(200000)); "RETURNED";'],
    "P3": ['await fetch("https://example.com");'],
    "P4": ['const fs = await import("fs"); text(fs.readFileSync("/etc/hosts", "utf8"));',
           'text(require("fs").readFileSync("/etc/hosts", "utf8"));',
           'text(await Deno.readTextFile("/etc/hosts"));'],
    "P5": ['text(String(process.env.PROBE_SECRET));'],
    "P6": ['while (true) {}'],
    "P7": ['const a = []; while (true) a.push("x".repeat(1e6) + a.length);'],
    "P8": ['globalThis.kept = 7; store("kept", 7);',
           'text(typeof kept === "undefined" ? "gone" : String(kept)); text("store/load: " + String(load("kept")));'],
    "P9": ['const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id: i}))); text(String(Date.now() - t));'],
    "P10": ['throw new Error("probe-boom");'],
    "P11": ['text(String(1+1));'] * 21,
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
        self.lock = threading.Lock()
        self.calls = 0
        self.next_id = 0

    def send(self, message):
        payload = json.dumps(message).encode()
        with self.lock:
            self.proc.stdin.write(struct.pack("<I", len(payload)) + payload)
            self.proc.stdin.flush()

    def recv(self):
        header = self.proc.stdout.read(4)
        if len(header) < 4:
            return None
        (length,) = struct.unpack("<I", header)
        return json.loads(self.proc.stdout.read(length))

    def request(self, request):
        self.next_id += 1
        self.send({"type": "operation/request", "id": self.next_id, "request": request})
        return self.next_id

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
        rid = self.request({"method": "session/open", "sessionId": session, "outputTruncation": "server"})
        return self.until(lambda m: m.get("id") == rid)

    def execute(self, session, source, index):
        calls_before = self.calls
        start = time.monotonic()
        rid = self.request({"method": "session/execute", "sessionId": session, "request": {
            "tool_call_id": f"call-{index}", "enabled_tools": [LOOKUP], "source": source}})
        message = self.until(lambda m: m["type"] == "execute/initialResponse" and m["id"] == rid)
        elapsed = (time.monotonic() - start) * 1000
        return {"source": source, "elapsed_ms": round(elapsed, 2), "host_calls": self.calls - calls_before,
                "response": message}

    def wait(self, session, cell_id):
        rid = self.request({"method": "session/wait", "sessionId": session,
                            "request": {"cell_id": cell_id, "yield_time_ms": 10000}})
        return self.until(lambda m: m["type"] == "operation/response" and m["id"] == rid)


def rss_kb(pid):
    r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def run_probe(probe):
    t0 = time.monotonic()
    host = Host(OUT / f"{probe}.stderr.txt")
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
    setup_ms = (time.monotonic() - t0) * 1000
    opened = host.open("s1")
    records = []
    for index, source in enumerate(PROBES[probe]):
        record = host.execute("s1", source, index)
        value = ((record["response"] or {}).get("result") or {}).get("value") or {}
        waits = []
        while "Yielded" in value and not killed[0]:
            reply = host.wait("s1", value["Yielded"]["cell_id"])
            waits.append({"t_ms": round((time.monotonic() - t0) * 1000), "reply": reply})
            outcome = (((reply or {}).get("result") or {}).get("value") or {}).get("outcome") or {}
            value = outcome.get("LiveCell") or outcome.get("MissingCell") or {}
        record["waits"] = waits
        records.append(record)
    done.set()
    wall = (time.monotonic() - t0) * 1000
    host.proc.kill()
    return {"probe": probe, "host": str(HOST), "hello": hello, "session_open": opened,
            "setup_ms": round(setup_ms, 2), "wall_ms": round(wall, 1), "peak_rss_mb": round(peak[0] / 1024, 1),
            "killed": killed[0], "records": records}


def clip(value):
    text = json.dumps(value)
    return text if len(text) <= 1500 else f"{text[:600]} ...[{len(text) - 1200} chars elided by harness]... {text[-600:]}"


def main(selected):
    OUT.mkdir(parents=True, exist_ok=True)
    for probe in selected:
        result = run_probe(probe)
        (OUT / f"{probe}.json").write_text(json.dumps(result, indent=1))
        lines = [f"probe: {probe} (codex code-mode host, V8)", f"host: {HOST.name} codex 0.169.0",
                 f"handshake: {json.dumps(result['hello'])}", f"session/open: {json.dumps(result['session_open'])}",
                 f"setup_ms (spawn + handshake): {result['setup_ms']}", f"wall_ms: {result['wall_ms']}",
                 f"peak_rss_mb: {result['peak_rss_mb']}", f"killed: {result['killed']}"]
        for i, r in enumerate(result["records"]):
            lines += ["", f"--- execution {i} ---", "source:", r["source"], f"elapsed_ms: {r['elapsed_ms']}",
                      f"host_calls: {r['host_calls']}", "initial response:", clip(r["response"])]
            for w in r["waits"]:
                lines.append(f"wait at t={w['t_ms']}ms: {clip(w['reply'])}")
            if probe == "P2" and r["response"]:
                text = json.dumps(r["response"])
                lines.append(f"count of 'A' in response: {text.count('A')}; contains RETURNED: {'RETURNED' in text}")
        if probe == "P11":
            times = sorted(r["elapsed_ms"] for r in result["records"][1:])
            lines += ["", f"first execution ms: {result['records'][0]['elapsed_ms']}",
                      f"20 later executions median ms: {statistics.median(times)}",
                      f"20 later executions p90 ms: {times[int(0.9 * len(times)) - 1]}"]
        (OUT / f"{probe}.txt").write_text("\n".join(lines) + "\n")
        print(f"{probe}: wall={result['wall_ms']}ms killed={result['killed']} first={clip(result['records'][0]['response'])[:300]}")


main(sys.argv[1:] or list(PROBES))
