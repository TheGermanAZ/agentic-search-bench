"""fastmcp CodeMode adapter: ONE FastMCP server with the CodeMode transform; each execution opens its own
in-process fastmcp.Client (a separate MCP client/user) and calls `execute`."""
import re

from fastmcp import Client, FastMCP
from fastmcp.experimental.transforms.code_mode import CodeMode, MontySandboxProvider

HARDENED = {"limits": {"max_feed_duration_secs": 10, "max_memory": 50_000_000}, "wall_clock_timeout_secs": 60}


def _call(name, args):
    m = re.fullmatch(r"id=(.+)", args.strip())
    payload = "{" + f'"id": {m.group(1)}' + "}" if m else "{}"
    return f'call_tool("{name}", {payload})'


class A:
    lang = "py"
    name = "fastmcp-codemode"
    T = staticmethod(lambda args: _call("lookup", args))
    F = staticmethod(lambda args: _call("failing", ""))
    R = staticmethod(lambda args: _call("rich", ""))


async def make(config, host):
    if config == "hardened":
        cm = CodeMode(sandbox_provider=MontySandboxProvider(limits=HARDENED["limits"]), wall_clock_timeout_secs=HARDENED["wall_clock_timeout_secs"])
    else:
        cm = CodeMode()
    mcp = FastMCP("verify", transforms=[cm])

    @mcp.tool
    async def lookup(id: int) -> dict:
        """Waits 200 ms, then returns {id, value: id * 2}."""
        return await host["lookup"](id)

    @mcp.tool
    async def failing() -> dict:
        """Always fails."""
        return await host["failing"]()

    @mcp.tool
    async def rich() -> dict:
        """Returns a rich object."""
        return await host["rich"]()

    a = A()
    a.notes = f"one FastMCP server, CodeMode({'hardened ' + str(HARDENED) if config == 'hardened' else 'defaults'}); new in-process Client per execution"

    async def exec(code):
        async with Client(mcp) as client:
            res = await client.call_tool("execute", {"code": code}, raise_on_error=False)
            return {"is_error": res.is_error, "text": "\n".join(getattr(c, "text", repr(c)) for c in res.content)}

    a.exec = exec
    return a
