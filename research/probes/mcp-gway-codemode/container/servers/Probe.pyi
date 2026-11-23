# servers/Probe.pyi
# Usage: Probe.tool_name(param=value)
# For detailed docs: use getToolDocs(server="Probe", tool="tool_name")
# Note: hyphenated MCP names are exposed sanitized (hyphens -> underscores).
# Use sanitized names in executeTool as Probe.tool_name(...).

def lookup(id: float) -> dict:  # Look up a record by id. Returns {id, value}.
    ...
