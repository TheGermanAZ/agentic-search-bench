# datalayer-codemode-monty probe harness

SPEC P1 to P12 plus the RUBRIC hardened run, through `CodeModeExecutor(registry, CodeModeConfig(sandbox_variant=...)).execute(code)` with one stdio MCP server (`lookup_server.py`). No model.

```bash
cd research/impls/datalayer-codemode-monty && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ../datalayer-codemode-eval/src "code-sandboxes[monty]==1.12.4" "pydantic-monty==0.0.18"   # ../datalayer-codemode-eval/src = git clone of datalayer/agent-codemode at 566e324
research/probes/datalayer-codemode-monty/run_all.sh
```

Venv used: `research/impls/datalayer-codemode-monty/.venv`. Uses its own venv with `pydantic-monty==0.0.18` (the last release with `MontyRepl`); `out/setup-crash-monty-1.6.0-*` is the same run against the current 1.6.0.

`probe_core.py` is the shared runner, `adapter.py` the Datalayer part, `meta.json` the source notes and display overrides merged by `collect`. Evidence: `out/<tag>.txt`.
