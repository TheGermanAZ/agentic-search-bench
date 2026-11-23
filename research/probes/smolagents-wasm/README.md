# smolagents-wasm probes

`WasmExecutor` (Pyodide in Deno) from smolagents 1.25.0, the last release that ships it (removed in 1.26.0). Needs `deno` on PATH. No LLM.

    cd research/impls/smolagents-wasm && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "smolagents==1.25.0"
    cd research/probes/smolagents-wasm && export PY=../../impls/smolagents-wasm/.venv/bin/python WASM_TMPDIR=/private/tmp/smolagents-wasm-tmp
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh $PY harness.py P7
    $PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../mem-lock.sh $PY harness.py --hardened P7

`WASM_TMPDIR` must be a canonical path outside this repo: on macOS a `/var/folders` temp dir breaks Deno's read grant, and a temp dir inside the repo makes Deno adopt the repo's `package.json` and write `deno.lock` at the root. Each start downloads Pyodide from npm and deno.land into that temp dir.
