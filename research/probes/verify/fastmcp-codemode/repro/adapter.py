"""FastMCP CodeMode adapter: a FastMCP server with one `lookup` tool and the CodeMode transform,
driven by an in-process fastmcp.Client calling the transformed server's `execute` tool."""

from fastmcp import Client, FastMCP
from fastmcp.experimental.transforms.code_mode import CodeMode, MontySandboxProvider

from probe_core import lookup_impl_async

PRELUDE = ""


def call(i):
    return f'await call_tool("lookup", {{"id": {i}}})'


def coro(i):
    return f'call_tool("lookup", {{"id": {i}}})'


def value(var):
    return f'{var}["value"]'


# Docs example limits (gofastmcp.com/docs/servers/transforms/code-mode, "Resource limits" and
# "Wall-clock limit" sections); max_tool_calls stays at its default of 50.
HARDENED = {
    "limits": {"max_feed_duration_secs": 10, "max_memory": 50_000_000},
    "wall_clock_timeout_secs": 60,
}


def make_server(config):
    if config == "hardened":
        cm = CodeMode(sandbox_provider=MontySandboxProvider(limits=HARDENED["limits"]),
                      wall_clock_timeout_secs=HARDENED["wall_clock_timeout_secs"])
    else:
        cm = CodeMode()
    mcp = FastMCP("probe", transforms=[cm])

    @mcp.tool
    async def lookup(id: int) -> dict:
        """Waits 200 ms, then returns {id, value: id * 2}."""
        return await lookup_impl_async(id)

    return mcp


async def open_session(config):
    client = Client(make_server(config))
    await client.__aenter__()
    return client


async def close_session(client):
    await client.__aexit__(None, None, None)


async def run(client, code):
    res = await client.call_tool("execute", {"code": code}, raise_on_error=False)
    texts = [getattr(c, "text", repr(c)) for c in res.content]
    out = {
        "ok": not res.is_error,
        "result": "\n".join(texts),
        "structured": res.structured_content,
        "stdout": "",
    }
    if res.is_error:
        out["error"] = out.pop("result")
    return out


# Extra beyond SPEC: the default max_tool_calls=50 cap, hit with 60 sequential calls.
EXTRA_PROBES = {
    "Pcap": ['n = 0\nfor i in range(60):\n    await call_tool("lookup", {"id": i})\n    n += 1\nn'],
}
