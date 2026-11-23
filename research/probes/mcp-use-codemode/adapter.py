"""mcp-use Python code mode (PyPI mcp-use 1.7.1).

Runs code the way an agent does: MCPClient(config, code_mode=True), then the internal
CodeModeConnector's call_tool("execute_code", {"code": ..., "timeout": ...}), which calls
MCPClient.execute_code -> CodeExecutor.execute (client/code_executor.py). The lookup tool
lives in a stdio MCP server (host_server.py) that counts calls in a file, so the host-side
count is real. Telemetry is turned off with MCP_USE_ANONYMIZED_TELEMETRY=false.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

os.environ["MCP_USE_ANONYMIZED_TELEMETRY"] = "false"
import psutil  # noqa: E402
from mcp_use import MCPClient  # noqa: E402

HERE = Path(__file__).resolve().parent
IMPL = "mcp-use-codemode"
COUNT = HERE / "out" / "lookup-count.txt"
os.environ["LOOKUP_COUNT_FILE"] = str(COUNT)
HARDENED_TIMEOUT = 10.0
RUN_IS_FRESH = True
_loop = asyncio.new_event_loop()
CONFIG = {"mcpServers": {"host": {"command": sys.executable, "args": [str(HERE / "host_server.py")],
                                  "env": {"LOOKUP_COUNT_FILE": str(COUNT)}}}}


class Session:
    def __init__(self, hardened):
        self.timeout = HARDENED_TIMEOUT if hardened else None
        self.client = MCPClient(config=CONFIG, code_mode=True)
        _loop.run_until_complete(self.client.create_all_sessions())
        self.connector = self.client.sessions["code_mode"].connector

    def run(self, code):
        args = {"code": code}
        if self.timeout is not None:
            args["timeout"] = self.timeout
        res = _loop.run_until_complete(self.connector.call_tool("execute_code", args))
        text = res.content[0].text
        d = json.loads(text)
        return {"ok": d["error"] is None, "stdout": "\n".join(d["logs"]), "result": d["result"],
                "error": d["error"], "raw_text_len": len(text)}

    def close(self):
        _loop.run_until_complete(self.client.close_all_sessions())


def new_session(hardened):
    return Session(hardened)


def lookup_call(id_expr):
    return f"await host.lookup(id={id_expr})"


prelude = ""


def host_calls():
    return len(COUNT.read_text().splitlines()) if COUNT.exists() else 0


extra_rss = lambda: 0  # noqa: E731


def kill_all():
    for p in psutil.Process().children(recursive=True):
        try:
            p.kill()
        except psutil.Error:
            pass


from core import PWN_MARK  # noqa: E402

OSM = "[c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close'][0].__init__.__globals__"
CODES = {
    "P2": 'print("A" * 200000)\n"RETURNED"',
    "P3": ('r, w = await asyncio.open_connection("example.com", 443, ssl=True)\n'
           'w.write(b"GET / HTTP/1.1\\r\\nHost: example.com\\r\\nConnection: close\\r\\n\\r\\n")\n'
           'line = (await r.readline()).decode()\nprint("STATUS", line.split()[1])'),
    "P4": f'try:\n    print(open("/etc/hosts").read())\nexcept Exception as e:\n    print("open failed:", e)\n    osm = {OSM}\n    fd = osm["open"]("/etc/hosts", osm["O_RDONLY"])\n    print(osm["read"](fd, 100000).decode())',
    "P5": f'try:\n    import os\n    print("ENV=" + str(os.environ.get("PROBE_SECRET")))\nexcept Exception as e:\n    print("import failed:", e)\n    osm = {OSM}\n    print("ENV=" + str(osm["environ"].get("PROBE_SECRET")))',
    "P8b": 'try:\n    print(kept)\nexcept Exception:\n    print("gone")',
    "P9": ("loop = asyncio.get_running_loop()\nt = loop.time()\n"
           "await asyncio.gather(*[host.lookup(id=i) for i in [1, 2, 3, 4, 5]])\nprint(int((loop.time() - t) * 1000))"),
    "P12c": f'p = await asyncio.create_subprocess_shell("echo PWNED-c; echo PWNED-c >> {PWN_MARK}")\nawait p.wait()\nprint("rc", p.returncode)',
}
EXTRAS = {
    "P2-return": ('print("A" * 200000)\nreturn "RETURNED"', "documented form: return a value"),
    "P3-urllib": ('import urllib.request\nprint(urllib.request.urlopen("https://example.com").status)', "SPEC form"),
    "P4-open": ('print(open("/etc/hosts").read())', "SPEC form"),
    "P6-async-loop": ("while True:\n    await asyncio.sleep(0)", "a loop that yields to the event loop: does the 30 s wait_for stop it"),
    "P9-loop": ("loop = asyncio.get_running_loop()\nt = loop.time()\nfor i in [1, 2, 3, 4, 5]:\n    await host.lookup(id=i)\nprint(int((loop.time() - t) * 1000))", "serial form"),
    "P10-trace": ("x = 1\nraise ValueError('probe-boom')", "what the model sees for an exception (error field only)"),
    "client-reach": ("print(type(search_tools).__name__, search_tools.__closure__ is not None)", "host closures reachable from guest"),
    "timeout-arg": ("return 1", "the model chooses the timeout: execute_code schema exposes it"),
}
