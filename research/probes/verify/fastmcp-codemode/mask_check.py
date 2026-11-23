"""Does FastMCP's server option mask_error_details=True stop host tool error text reaching sandboxed code?
Run: ../../../impls/fastmcp-codemode/.venv/bin/python mask_check.py  -> out/mask_check.txt"""
import asyncio
from pathlib import Path

from fastmcp import Client, FastMCP
from fastmcp.experimental.transforms.code_mode import CodeMode

CODE = 'try:\n    await call_tool("failing", {})\n    o = "no throw"\nexcept Exception as e:\n    o = str(e)\no'


async def main():
    lines = []
    for mask in (False, True):
        mcp = FastMCP("mask", transforms=[CodeMode()], mask_error_details=mask)

        @mcp.tool
        async def failing() -> dict:
            """Always fails."""
            raise RuntimeError("host-tool-boom internal detail db=postgres://user:pw@host")

        async with Client(mcp) as c:
            r = await c.call_tool("execute", {"code": CODE}, raise_on_error=False)
            lines.append(f"mask_error_details={mask}: {[getattr(x, 'text', x) for x in r.content]}")
    text = "\n".join(lines)
    print(text)
    (Path(__file__).parent / "out" / "mask_check.txt").write_text(text + "\n")


asyncio.run(main())
