"""One attempt to run P1 through HyperlightExecuteCodeTool on this machine. Prints the exact outcome."""
import asyncio
import platform
import sys
import time
import traceback
import importlib.metadata as m

from agent_framework import tool
from agent_framework_hyperlight import HyperlightExecuteCodeTool

calls = {"n": 0}


@tool
def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    calls["n"] += 1
    time.sleep(0.2)
    return {"id": id, "value": id * 2}


async def main():
    print("platform:", platform.platform(), platform.machine(), "python", sys.version.split()[0])
    for p in ["agent-framework-hyperlight", "agent-framework-core", "hyperlight-sandbox", "hyperlight-sandbox-python-guest", "hyperlight-sandbox-backend-wasm"]:
        try:
            print(" ", p, m.version(p))
        except m.PackageNotFoundError:
            print(" ", p, "NOT INSTALLED")
    ex = HyperlightExecuteCodeTool(tools=[lookup], approval_mode="never_require", include_detailed_errors=True)
    code = 'r = call_tool("lookup", id=21)\nprint(r["value"])'
    try:
        res = await ex.invoke(arguments={"code": code})
        print("result:", res)
    except BaseException as e:
        print("EXCEPTION:", type(e).__name__, e)
        traceback.print_exc(file=sys.stdout)
    print("host calls:", calls["n"])


asyncio.run(main())
