"""stdio MCP server exposing the SPEC host tool `lookup`. Each call appends a line to LOOKUP_COUNT_FILE."""
import asyncio
import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("host")


@mcp.tool()
async def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    with open(os.environ["LOOKUP_COUNT_FILE"], "a") as f:
        f.write("1\n")
    await asyncio.sleep(0.2)
    return {"id": id, "value": id * 2}


if __name__ == "__main__":
    mcp.run()
