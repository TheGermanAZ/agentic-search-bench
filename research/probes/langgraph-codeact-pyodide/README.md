# langgraph-codeact-pyodide probe harness

SPEC P1 to P12 plus the hardened run through `create_codeact` with `create_pyodide_eval_fn(PyodideSandbox(allow_net=True))` from `examples/pyodide_sandbox_example.py` (copied verbatim, one line added to pass `timeout_seconds`/`memory_limit_mb` in the hardened run).

```bash
# same venv as langgraph-codeact (research/impls/langgraph-codeact/.venv-lock, from the repo's uv.lock); needs deno on PATH
research/probes/langgraph-codeact-pyodide/run_all.sh
```

`deno.json` in this folder is required: without it Deno's `--node-modules-dir=auto` installs into the repo root's `node_modules`. Probes ending in `s` (P1s, P9s) register `probe_tools_selfcontained.lookup`, a copy of the tool whose import is inside the function, because the example pastes tool source into the sandbox. Evidence: `out/<tag>.txt`.
