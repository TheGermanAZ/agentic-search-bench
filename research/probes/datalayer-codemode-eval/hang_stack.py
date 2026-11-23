"""Extra evidence for P1: dump every thread's stack 15 s into a single lookup call through the
eval variant, to show where it waits. Writes out/P1-stack.txt."""
import asyncio
import faulthandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapter  # noqa: E402

out = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "P1-stack.txt"), "w")
faulthandler.dump_traceback_later(15, exit=True, file=out)


async def main():
    ex = await adapter.open_session("default")
    out.write("first execution (no tool call): " + repr(await adapter.run(ex, "print(1 + 1)")) + "\n")
    out.flush()
    await adapter.run(ex, adapter.PRELUDE + "r = await lookup({'id': 21})\nprint(r)")


asyncio.run(main())
