"""Python sidecar for the py-* code-mode engines (src/engines/py-*.ts).

One long-lived process per engine per Node host. Guest code never runs here: every engine executes it in
Monty worker subprocesses, and this process only shuttles messages. Protocol, one JSON object per line:

  Node -> sidecar (stdin):   {"t":"run","id":N,"code":"..."}    {"t":"result","id":N,"c":C,"json":"..."}
                             {"t":"cancel","id":N}
  sidecar -> Node (stdout*):   {"t":"ready","versions":{...}}     {"t":"call","id":N,"c":C,"name":"count","args":"[...]"}
                             {"t":"out","id":N,"text":"..."}    {"t":"done","id":N,"value"?:..,"error"?:..,"dropped":n}

* The protocol uses a private copy of the original stdout. File descriptor 1 is pointed at /dev/null before any
  library loads, because FastMCP's CodeMode lets Monty write print() output to the host's stdout.

Usage: python sidecar.py monty|fastmcp|pydantic-ai   (config in ASB_* environment variables, set by Node)
"""

import os

# Telemetry and update checks off before any library is imported.
os.environ.update(
    {
        "DO_NOT_TRACK": "1",
        "OTEL_SDK_DISABLED": "true",
        "OTEL_TRACES_EXPORTER": "none",
        "OTEL_METRICS_EXPORTER": "none",
        "OTEL_LOGS_EXPORTER": "none",
        "LOGFIRE_SEND_TO_LOGFIRE": "false",
        "LOGFIRE_IGNORE_NO_CONFIG": "1",
        "FASTMCP_TELEMETRY_MODE": "off",
        "FASTMCP_CHECK_FOR_UPDATES": "off",
        "FASTMCP_SHOW_SERVER_BANNER": "false",
        "FASTMCP_ENABLE_RICH_LOGGING": "false",
    }
)

import asyncio  # noqa: E402
import itertools  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import traceback  # noqa: E402
from typing import Any  # noqa: E402

_proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
_devnull = os.open(os.devnull, os.O_WRONLY)
os.dup2(_devnull, 1)
os.close(_devnull)
sys.stdout = open(1, "w", encoding="utf-8", buffering=1, closefd=False)  # noqa: SIM115

MODE = sys.argv[1] if len(sys.argv) > 1 else "monty"
CFG = {
    "max_concurrent": int(os.environ.get("ASB_MAX_CONCURRENT", "8")),
    "memory_bytes": int(os.environ.get("ASB_MEMORY_BYTES", str(512 * 1024 * 1024))),
    "cpu_secs": float(os.environ.get("ASB_CPU_SECS", "60")),
    "max_output": int(os.environ.get("ASB_MAX_OUTPUT", "8000")),
}

_write_lock = threading.Lock()


def send(msg: dict[str, Any]) -> None:
    line = json.dumps(msg, ensure_ascii=False, default=str)
    with _write_lock:
        _proto.write(line + "\n")
        _proto.flush()


class CorpusError(RuntimeError):
    """A corpus call failed on the host; the message was already scrubbed by Node's cleanError()."""


class Execution:
    """One program run: forwards corpus calls to Node and streams capped output."""

    def __init__(self, exec_id: int, code: str, loop: asyncio.AbstractEventLoop):
        self.id = exec_id
        self.code = code
        self.loop = loop
        self.calls: dict[int, asyncio.Future[str]] = {}
        self.sent = 0
        self.dropped = 0
        self._ids = itertools.count()

    async def call(self, name: str, args: list[Any]) -> Any:
        cid = next(self._ids)
        fut: asyncio.Future[str] = self.loop.create_future()
        self.calls[cid] = fut
        send({"t": "call", "id": self.id, "c": cid, "name": name, "args": json.dumps(args, default=str)})
        try:
            text = await fut
        finally:
            self.calls.pop(cid, None)
        value = json.loads(text)
        if isinstance(value, dict) and "__error" in value:
            raise CorpusError(str(value["__error"]))
        return value

    def out(self, text: str) -> None:
        """Forwards printed text until the cap, then only counts it (thread-safe: may run in a portal thread)."""
        room = CFG["max_output"] - self.sent
        if len(text) > room:
            self.dropped += len(text) - max(room, 0)
        if room <= 0:
            return
        part = text[:room]
        self.sent += len(part)
        send({"t": "out", "id": self.id, "text": part})


def show(value: Any) -> str:
    """Renders a final value the way the JS engines do: strings as-is, everything else as JSON."""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def clip(text: str, room: int, *, keep_tail: bool) -> str:
    """Cuts text to about `room` chars with a marker; errors keep their end, where the exception line is."""
    if len(text) <= room:
        return text
    cut = len(text) - room
    if keep_tail:
        head = min(1000, room // 4)
        return f"{text[:head]}\n[... {cut} chars cut ...]\n{text[-(room - head):]}"
    return f"{text[:room]}\n[value truncated: {cut} more chars. Return or print less.]"


def merge(opts: Any, kw: dict[str, Any]) -> Any:
    """Filter dict as the first positional argument, plus keyword arguments (from_ means from)."""
    if not kw:
        return {} if opts is None else opts
    merged = dict(opts) if isinstance(opts, dict) else {}
    for k, v in kw.items():
        merged["from" if k == "from_" else k] = v
    return merged


# --- engine: py-monty --------------------------------------------------------------------------------------


class MontyEngine:
    """pydantic-monty directly: an AsyncMonty worker pool, one fresh session (and worker process) per run."""

    async def setup(self) -> dict[str, str]:
        import pydantic_monty

        self.pm = pydantic_monty
        # max_checkouts_per_worker=1: every run gets a new worker process; min_processes keeps two warm.
        # request_timeout: the pool kills a worker whose turn outlives the sandbox's own duration limit.
        self.pool = pydantic_monty.AsyncMonty(
            max_processes=CFG["max_concurrent"],
            min_processes=2,
            max_checkouts_per_worker=1,
            request_timeout=CFG["cpu_secs"] + 5,
        )
        await self.pool.__aenter__()
        return {"pydantic-monty": pydantic_monty.__version__}

    def functions(self, ex: Execution) -> dict[str, Any]:
        async def search(query, opts=None, **kw):
            return await ex.call("search", [query, merge(opts, kw)])

        async def grep(pattern, opts=None, **kw):
            return await ex.call("grep", [pattern, merge(opts, kw)])

        async def messages(filter=None, **kw):  # noqa: A002
            return await ex.call("messages", [merge(filter, kw)])

        async def count(filter=None, **kw):  # noqa: A002
            return await ex.call("count", [merge(filter, kw)])

        async def people(name_or_email):
            return await ex.call("people", [name_or_email])

        async def read(id):  # noqa: A002
            return await ex.call("read", [id])

        return {"search": search, "grep": grep, "messages": messages, "count": count, "people": people, "read": read}

    async def run(self, ex: Execution) -> tuple[str | None, str | None]:
        pm = self.pm
        limits = {"max_memory": CFG["memory_bytes"], "max_feed_duration_secs": CFG["cpu_secs"]}
        try:
            async with self.pool.checkout(limits=limits) as session:
                value = await session.feed_run(
                    ex.code,
                    external_lookup=self.functions(ex),
                    print_callback=lambda _stream, text: ex.out(text),
                )
            return (None if value is None else show(value)), None
        except pm.MontyRuntimeError as e:
            return None, e.display("traceback")
        except pm.MontySyntaxError as e:
            return None, e.display("traceback")
        except pm.MontyCrashedError as e:
            return None, f"the sandbox stopped this program (worker process ended: {e})"
        except pm.MontyError as e:
            return None, str(e)

    async def close(self) -> None:
        await self.pool.__aexit__(None, None, None)


# --- engine: py-fastmcp ------------------------------------------------------------------------------------


class FastMCPEngine:
    """FastMCP 4.2.4 CodeMode as shipped: a FastMCP server whose six tools forward to Node, transformed with
    CodeMode, driven through its own `execute` tool by an in-process FastMCP client. One server per run."""

    async def setup(self) -> dict[str, str]:
        import fastmcp
        import pydantic_monty
        from fastmcp.experimental.transforms.code_mode import CodeMode, MontySandboxProvider

        self.fastmcp = fastmcp
        self.CodeMode = CodeMode
        self.MontySandboxProvider = MontySandboxProvider
        return {"fastmcp": fastmcp.__version__, "pydantic-monty": pydantic_monty.__version__}

    def server(self, ex: Execution):
        from typing import Annotated, Literal

        from fastmcp import FastMCP
        from fastmcp.exceptions import ToolError
        from pydantic import Field

        mcp = FastMCP("corpus", mask_error_details=True)
        S = str | None

        def flt(from_, to, involves, after, before, subjectContains, **extra):
            d = {"from": from_, "to": to, "involves": involves, "after": after, "before": before, "subjectContains": subjectContains, **extra}
            return {k: v for k, v in d.items() if v is not None}

        async def call(name: str, args: list[Any]) -> Any:
            try:
                return await ex.call(name, args)
            except CorpusError as e:
                raise ToolError(str(e)) from None

        From = Annotated[S, Field(alias="from", description="substring of sender address or display name")]
        To = Annotated[S, Field(description="substring of a To or Cc address")]
        Involves = Annotated[S, Field(description="substring of sender or any recipient address")]
        After = Annotated[S, Field(description="ISO date, inclusive")]
        Before = Annotated[S, Field(description="ISO date, exclusive")]
        Subj = Annotated[S, Field(description="substring of the subject")]

        @mcp.tool
        async def search(
            query: str,
            k: Annotated[int | None, Field(description="results, default 10, max 50")] = None,
            mode: Literal["hybrid", "keyword", "semantic"] | None = None,
            from_: From = None, to: To = None, involves: Involves = None, after: After = None, before: Before = None, subjectContains: Subj = None,
        ) -> list[dict[str, Any]]:
            """Ranked search. mode "hybrid" (default) fuses BM25 keyword search and embedding search with reciprocal rank fusion; "keyword" is BM25 only, "semantic" is embeddings only. Filters narrow before ranking. Returns messages with score and snippet."""
            return await call("search", [query, flt(from_, to, involves, after, before, subjectContains, k=k, mode=mode)])

        @mcp.tool
        async def grep(
            pattern: str,
            limit: Annotated[int | None, Field(description="hits returned, default 50, max 500")] = None,
            caseSensitive: bool | None = None,
            from_: From = None, to: To = None, involves: Involves = None, after: After = None, before: Before = None, subjectContains: Subj = None,
        ) -> dict[str, Any]:
            """Regex over the full text of every message (headers and body), ripgrep syntax, case-insensitive unless caseSensitive. Returns {totalFiles, hits}: totalFiles counts every matching message after filters; hits holds the first `limit` with the first matching line."""
            return await call("grep", [pattern, flt(from_, to, involves, after, before, subjectContains, limit=limit, caseSensitive=caseSensitive)])

        @mcp.tool
        async def messages(
            limit: Annotated[int | None, Field(description="default 100, max 5000")] = None,
            from_: From = None, to: To = None, involves: Involves = None, after: After = None, before: Before = None, subjectContains: Subj = None,
        ) -> list[dict[str, Any]]:
            """Metadata query, no text matching. Sorted by date."""
            return await call("messages", [flt(from_, to, involves, after, before, subjectContains, limit=limit)])

        @mcp.tool
        async def count(
            from_: From = None, to: To = None, involves: Involves = None, after: After = None, before: Before = None, subjectContains: Subj = None,
        ) -> int:
            """Exact number of messages matching a metadata filter (no limit)."""
            return await call("count", [flt(from_, to, involves, after, before, subjectContains)])

        @mcp.tool
        async def people(nameOrEmail: str) -> list[dict[str, Any]]:
            """Resolve a name or address fragment to sender addresses, most active first."""
            return await call("people", [nameOrEmail])

        @mcp.tool
        async def read(id: str) -> dict[str, Any] | None:  # noqa: A002
            """One full message, body capped at 20k chars."""
            return await call("read", [id])

        sandbox = self.MontySandboxProvider(limits={"max_memory": CFG["memory_bytes"], "max_feed_duration_secs": CFG["cpu_secs"]})
        # No discovery tools: the model gets the catalog in apiDoc and only ever calls `execute`.
        mcp.add_transform(self.CodeMode(sandbox_provider=sandbox, discovery_tools=[]))
        return mcp

    async def run(self, ex: Execution) -> tuple[str | None, str | None]:
        from fastmcp import Client
        from mcp_types import TextContent

        async with Client(self.server(ex)) as client:
            result = await client.call_tool("execute", {"code": ex.code}, raise_on_error=False)
        text = "\n".join(c.text for c in result.content if isinstance(c, TextContent))
        if result.is_error:
            return None, text or "execute failed"
        return text, None

    async def close(self) -> None:
        pass


# --- engine: py-pydantic-ai --------------------------------------------------------------------------------


class PydanticAIEngine:
    """Pydantic AI Harness 0.71.0 CodeModeToolset (run_code over Monty), called without an agent: a RunContext
    and ToolManager are built per run the way the agent graph builds them, and run_code goes through
    ToolManager.handle_call. The placeholder model in RunContext is never called."""

    async def setup(self) -> dict[str, str]:
        from typing import Literal, TypedDict

        import pydantic_ai
        import pydantic_ai_harness
        import pydantic_monty
        from pydantic_ai import RunContext
        from pydantic_ai.toolsets import FunctionToolset
        from pydantic_ai_harness.code_mode import CodeModeToolset

        Filter = TypedDict(
            "Filter",
            {"from": str, "to": str, "involves": str, "after": str, "before": str, "subjectContains": str},
            total=False,
        )
        SearchOpts = TypedDict("SearchOpts", {"k": int, "mode": Literal["hybrid", "keyword", "semantic"]}, total=False)
        GrepOpts = TypedDict("GrepOpts", {"limit": int, "caseSensitive": bool}, total=False)
        Limit = TypedDict("Limit", {"limit": int}, total=False)
        SearchOptions = TypedDict("SearchOptions", {**Filter.__annotations__, **SearchOpts.__annotations__}, total=False)
        GrepOptions = TypedDict("GrepOptions", {**Filter.__annotations__, **GrepOpts.__annotations__}, total=False)
        MessagesFilter = TypedDict("MessagesFilter", {**Filter.__annotations__, **Limit.__annotations__}, total=False)
        Ctx = RunContext[Execution]

        async def search(ctx: Ctx, query: str, opts: SearchOptions | None = None) -> list[dict[str, Any]]:
            """Ranked search. mode "hybrid" (default) fuses BM25 keyword search and embedding search with reciprocal rank fusion; "keyword" is BM25 only, "semantic" is embeddings only. Filters narrow before ranking. k defaults to 10, max 50. Returns messages with score and snippet."""
            return await ctx.deps.call("search", [query, opts or {}])

        async def grep(ctx: Ctx, pattern: str, opts: GrepOptions | None = None) -> dict[str, Any]:
            """Regex over the full text of every message (headers and body), ripgrep syntax, case-insensitive unless caseSensitive. Returns {"totalFiles", "hits"}: totalFiles counts every matching message after filters; hits holds the first `limit` (default 50, max 500) with the first matching line."""
            return await ctx.deps.call("grep", [pattern, opts or {}])

        async def messages(ctx: Ctx, filter: MessagesFilter | None = None) -> list[dict[str, Any]]:  # noqa: A002
            """Metadata query, no text matching. Sorted by date. limit defaults to 100, max 5000."""
            return await ctx.deps.call("messages", [filter or {}])

        async def count(ctx: Ctx, filter: Filter | None = None) -> int:  # noqa: A002
            """Exact number of messages matching a metadata filter (no limit)."""
            return await ctx.deps.call("count", [filter or {}])

        async def people(ctx: Ctx, name_or_email: str) -> list[dict[str, Any]]:
            """Resolve a name or address fragment to sender addresses, most active first."""
            return await ctx.deps.call("people", [name_or_email])

        async def read(ctx: Ctx, id: str) -> dict[str, Any] | None:  # noqa: A002
            """One full message, body capped at 20k chars. None when the id is unknown."""
            return await ctx.deps.call("read", [id])

        self.toolset = CodeModeToolset(
            FunctionToolset([search, grep, messages, count, people, read]),
            resource_limits={"max_duration_seconds": CFG["cpu_secs"], "max_memory": CFG["memory_bytes"]},
        )
        return {
            "pydantic-ai-harness": pydantic_ai_harness.__version__ if hasattr(pydantic_ai_harness, "__version__") else "0.71.0",
            "pydantic-ai-slim": pydantic_ai.__version__,
            "pydantic-monty": pydantic_monty.__version__,
        }

    async def run(self, ex: Execution) -> tuple[str | None, str | None]:
        from dataclasses import replace

        from pydantic_ai import RunContext
        from pydantic_ai.capabilities.combined import CombinedCapability
        from pydantic_ai.exceptions import ToolRetryError
        from pydantic_ai.messages import ToolCallPart, ToolReturn
        from pydantic_ai.models.test import TestModel
        from pydantic_ai.tool_manager import ToolManager
        from pydantic_ai.usage import RunUsage

        ctx = RunContext(deps=ex, model=TestModel(), usage=RunUsage())
        toolset = await self.toolset.for_run(ctx)  # fresh REPL state, as for each agent run
        async with toolset:
            manager = await ToolManager(toolset=toolset, root_capability=CombinedCapability([])).for_run_step(ctx)
            ctx = replace(ctx, tool_manager=manager)
            manager.ctx = ctx
            try:
                ret = await manager.handle_call(ToolCallPart("run_code", {"code": ex.code}))
            except ToolRetryError as e:
                return None, str(e)
        value = ret.return_value if isinstance(ret, ToolReturn) else ret
        if isinstance(value, dict):
            ex.out(str(value.get("output", "")))
            return (show(value["result"]) if "result" in value else None), None
        return show(value), None

    async def close(self) -> None:
        pass


# --- main loop ---------------------------------------------------------------------------------------------


async def main() -> None:
    engine = {"monty": MontyEngine, "fastmcp": FastMCPEngine, "pydantic-ai": PydanticAIEngine}[MODE]()
    versions = await engine.setup()
    loop = asyncio.get_running_loop()
    executions: dict[int, Execution] = {}
    tasks: dict[int, asyncio.Task[None]] = {}

    async def run_one(ex: Execution) -> None:
        value: str | None = None
        error: str | None = None
        try:
            value, error = await engine.run(ex)
        except asyncio.CancelledError:
            error = "cancelled by the host"
        except Exception as e:  # noqa: BLE001
            error = f"the sandbox stopped this program (engine fault): {type(e).__name__}: {e}"
            traceback.print_exc(file=sys.stderr)
        finally:
            executions.pop(ex.id, None)
            tasks.pop(ex.id, None)
        msg: dict[str, Any] = {"t": "done", "id": ex.id, "dropped": ex.dropped}
        # A final value or error text is capped too: the host appends it after the capped output unchecked, and
        # Pydantic AI Harness embeds everything printed before an error (up to 10 MiB) in the error text.
        room = max(1000, CFG["max_output"] - ex.sent)
        if error is not None:
            msg["error"] = clip(error, room, keep_tail=True)
        elif value is not None:
            msg["value"] = clip(value, room, keep_tail=False)
        send(msg)

    reader = asyncio.StreamReader(limit=256 * 1024 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    send({"t": "ready", "mode": MODE, "versions": versions, "pid": os.getpid()})
    while True:
        line = await reader.readline()
        if not line:
            break
        msg = json.loads(line)
        t = msg.get("t")
        if t == "run":
            ex = Execution(int(msg["id"]), str(msg["code"]), loop)
            executions[ex.id] = ex
            tasks[ex.id] = asyncio.create_task(run_one(ex))
        elif t == "result":
            ex = executions.get(int(msg["id"]))
            fut = ex.calls.get(int(msg["c"])) if ex else None
            if fut is not None and not fut.done():
                fut.set_result(str(msg["json"]))
        elif t == "cancel":
            task = tasks.get(int(msg["id"]))
            if task is not None:
                task.cancel()
    # stdin closed: the host went away. Cancel what is running (this kills Monty workers) and exit.
    for task in list(tasks.values()):
        task.cancel()
    await asyncio.gather(*tasks.values(), return_exceptions=True)
    await engine.close()


if __name__ == "__main__":
    asyncio.run(main())
