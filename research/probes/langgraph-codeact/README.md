# langgraph-codeact probe harness

SPEC P1 to P12 through the real `create_codeact` graph with the eval function from `examples/math_example.py` (copied verbatim) and a scripted fake chat model. No hardened run (see the results file).

```bash
cd research/impls/langgraph-codeact/src && UV_PROJECT_ENVIRONMENT=../.venv-lock uv sync --frozen --python 3.12   # src = git clone at de14f16, installs the repo's uv.lock
research/probes/langgraph-codeact/run_all.sh
```

The default run compiles the graph without a checkpointer and passes `context` back in. `out-memorysaver-lock/` is the same suite compiled with `MemorySaver` as the examples do (lockfile versions); `out-latest/` is that with current langgraph 1.0.1 (`research/impls/langgraph-codeact/.venv`). Evidence: `out/<tag>.txt`.
