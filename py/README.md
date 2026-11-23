# Python sidecar for the py-* code-mode engines

`sidecar.py` is started by `src/engines/py-sidecar.ts` (`uv run --frozen --project py python -I py/sidecar.py <mode>`), one long-lived process per engine, and speaks JSON lines with Node. Guest code never runs in it: all three modes execute programs in Monty worker subprocesses.

| mode | engine | what runs the program |
|---|---|---|
| `monty` | `py-monty` | `pydantic_monty.AsyncMonty` pool, fresh session and worker process per execution |
| `fastmcp` | `py-fastmcp` | FastMCP 4.2.4 `CodeMode` `execute` tool on a per-execution FastMCP server, in-process client |
| `pydantic-ai` | `py-pydantic-ai` | Pydantic AI Harness 0.71.0 `CodeModeToolset` `run_code`, called through `ToolManager.handle_call` without an agent |

Pins are in `pyproject.toml` and `uv.lock` (Python 3.12). Install or refresh with `uv sync --frozen --project py`; the engines also do this on first use. Telemetry and update checks are switched off at the top of `sidecar.py` before any import. Design, evidence and probe results: `research/probes/engines/PY-ENGINES.md`.
