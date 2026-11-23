# restrictedpython-codemode probe harness

SPEC P1-P12 against `sandbox.executor.CodeExecutor` from imran31415/codemode_python_benchmark @ 363507e, with no model. There is no hardened configuration (the executor takes no options).

```bash
cd research/impls/restrictedpython-codemode && git clone https://github.com/imran31415/codemode_python_benchmark src && git -C src checkout 363507e && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python RestrictedPython==9.0 psutil certifi
cd research/probes/restrictedpython-codemode && ./run_all.sh && ../../impls/restrictedpython-codemode/.venv/bin/python collect.py
```

`core.py` is the shared driver (one probe per process, 120 s / 4 GB watchdog); `adapter.py` wires the executor. `meta.py` holds the source notes; `collect.py` writes `research/probes/results/restrictedpython-codemode.json`.

README-number check (no model API): `git -C ../../impls/restrictedpython-codemode/src show 917128b:benchmark_results_claude.json > /tmp/x/917128b_claude.json` for each file, then `python3 -I recompute_readme.py <dir>`. Output: `out/readme-recompute.txt`.
