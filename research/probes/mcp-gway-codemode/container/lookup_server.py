"""SPEC `lookup` tool as a stdio MCP server, run inside the mcp-gway container (uses the image's own `mcp` package).
Waits 200 ms, returns {id, value: id*2}, and appends one line per call to $LOOKUP_COUNT_FILE."""
import asyncio, json, os, time
from mcp.server.mcpserver import MCPServer  # mcp 2.x (the image ships mcp 2.0.0; FastMCP was renamed)

mcp = MCPServer("probe")

@mcp.tool(description="Look up a record by id. Returns {id, value}.")
async def lookup(id: float) -> str:
    with open(os.environ["LOOKUP_COUNT_FILE"], "a") as fh:
        fh.write(f"{int(time.time() * 1000)} {id}\n")
    await asyncio.sleep(0.2)
    v = int(id) if float(id).is_integer() else id
    return json.dumps({"id": v, "value": v * 2})

if __name__ == "__main__":
    mcp.run("stdio")
