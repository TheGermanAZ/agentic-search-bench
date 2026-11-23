# mcp-run-python probes

Pins: `mcp-run-python` 0.0.22 from `pydantic/mcp-run-python` at commit `4f93a9261d5e9905cb3e93b4817bda7c3470ac00` (archived; last commit "archive notice", 2026-01-30). Deno 2.9.8 (Homebrew). The build step `python3 -I build/build.py` generates `mcp_run_python/deno/src/prepareEnvCode.ts`, which the clone does not contain (it is gitignored). Pyodide is pinned by the repo to `pyodide@0.28.2` through `deno.jsonc`.

Entry point: `mcp_run_python.async_prepare_deno_env` (the helper `code_sandbox` uses), then the MCP stdio transport and the `run_python_code` tool. P5 and P12 also run once with the full host environment passed to deno (`with_env=True`).

Rerun (about 4 to 5 minutes; P6 takes 120 s, P11 about 70 s):

    cd research/probes/mcp-run-python
    ../../impls/mcp-run-python/.venv/bin/python run_probes.py          # P1..P12, plus P7b (JS-side memory variant)
    ../../impls/mcp-run-python/.venv/bin/python run_probes.py P4 P12   # some probes

Outputs: `out/<probe>.txt`, `out/<probe>.json`, `out/summary.json`.

Setup, if the venv is missing:

    cd research/impls/mcp-run-python
    git clone --depth 1 https://github.com/pydantic/mcp-run-python src
    python3 -I src/build/build.py
    uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -e ./src

Network: the probes contact only `https://example.com` (P3). The first `async_prepare_deno_env` call per server runs `deno` dependency install and `loadPyodide` / `loadPackage`, which fetch npm and the Pyodide CDN. That traffic is part of the implementation's startup, not probe traffic.

Harness rules: P6 and P7 (and P7b) run in a child process. The parent kills the process group at 120 s. P7 and P7b are also killed at 4 GiB summed RSS of the process tree. P11 gets 900 s.

Repeats and reruns: `p7_repeat.py 5` writes `out/P7_repeats.txt`, and P7b was repeated 3 times into `out/P7b_repeats.txt`. `summary.json` comes from the full run before the P7 repeats and the asserted P11 rerun. The per-probe `.txt` files are the latest runs.
Repeat helper for P7 (writes out/P7_repeats.txt):

    ../../impls/mcp-run-python/.venv/bin/python p7_repeat.py 5
