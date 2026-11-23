"""Extra probe P2-stdio: where does sandbox print() go when the CodeMode server runs over stdio?

Runs three executions through a stdio subprocess server: a print, a 200,000-char print, then a
plain return. Writes out/P2-stdio.txt.
"""
import asyncio
import sys
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import PythonStdioTransport

HERE = Path(__file__).resolve().parent


async def main():
    lines = []
    transport = PythonStdioTransport(str(HERE / "stdio_server.py"), python_cmd=sys.executable)
    async with Client(transport) as c:
        for code in ['print("hello from sandbox")\n"RET1"', 'print("A" * 200000)\n"RET2"', '"RET3"']:
            try:
                r = await asyncio.wait_for(c.call_tool("execute", {"code": code}, raise_on_error=False), 30)
                lines.append(f"code={code[:40]!r} -> is_error={r.is_error} content={[getattr(x, 'text', x) for x in r.content]!r}"[:400])
            except Exception as e:  # noqa: BLE001
                lines.append(f"code={code[:40]!r} -> raised {type(e).__name__}: {e}"[:400])
    out = "\n".join(lines)
    (HERE / "out" / "P2-stdio.txt").write_text(out + "\n")
    print(out)


asyncio.run(main())
