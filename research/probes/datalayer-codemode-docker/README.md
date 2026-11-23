# datalayer-codemode-docker probe harness

SPEC P1 to P12 plus the RUBRIC hardened run, through `CodeModeExecutor(registry, CodeModeConfig(sandbox_variant=...)).execute(code)` with one stdio MCP server (`lookup_server.py`). No model.

```bash
cd research/impls/datalayer-codemode-eval && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ./src "code-sandboxes[monty,docker]==1.12.4" ipykernel   # src = git clone of datalayer/agent-codemode at 566e324
research/probes/datalayer-codemode-docker/run_all.sh
```

Venv used: `research/impls/datalayer-codemode-eval/.venv`. Needs the image: `cd research/impls/datalayer-codemode-docker/code-sandboxes && docker build -t datalayer-codemode-docker-jupyter:1.12.4 -f docker/Dockerfile .` (the documented build, under this worker's tag). Containers are named `datalayer-codemode-docker-*` and removed after each probe. `out/home-env-repro.txt` reproduces the HOME failure with plain `docker run`.

`probe_core.py` is the shared runner, `adapter.py` the Datalayer part, `meta.json` the source notes and display overrides merged by `collect`. Evidence: `out/<tag>.txt`.
