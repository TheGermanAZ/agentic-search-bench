# datalayer-codemode-jupyter probe harness

SPEC P1 to P12 plus the RUBRIC hardened run, through `CodeModeExecutor(registry, CodeModeConfig(sandbox_variant=...)).execute(code)` with one stdio MCP server (`lookup_server.py`). No model.

```bash
cd research/impls/datalayer-codemode-eval && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ./src "code-sandboxes[monty,docker]==1.12.4" ipykernel   # src = git clone of datalayer/agent-codemode at 566e324
research/probes/datalayer-codemode-jupyter/run_all.sh
```

Venv used: `research/impls/datalayer-codemode-eval/.venv`. The variant starts its own Jupyter Server on port 41520 with the venv's interpreter; the harness kills the recorded server process group after each probe.

`probe_core.py` is the shared runner, `adapter.py` the Datalayer part, `meta.json` the source notes and display overrides merged by `collect`. Evidence: `out/<tag>.txt`.
