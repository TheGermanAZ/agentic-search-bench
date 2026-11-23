"""Stdio MCP server (MCP Python SDK 2, as agent-codemode uses) exposing the SPEC host tool `lookup`.
Each call is logged by probe_core.log_call to the file named in PROBE_CALL_LOG."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp.server import MCPServer  # noqa: E402

from probe_core import lookup_impl_async  # noqa: E402

mcp = MCPServer("probe")


@mcp.tool()
async def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    return await lookup_impl_async(id)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "http":
        mcp.run("streamable-http", host="127.0.0.1", port=int(sys.argv[2]))
    else:
        mcp.run()
