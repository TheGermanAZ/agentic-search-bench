# fastmcp-codemode probe harness

SPEC P1 to P12 plus the RUBRIC hardened run, through FastMCP's `CodeMode` transform with an in-process `fastmcp.Client` calling `execute`. No model.

```bash
cd research/impls/fastmcp-codemode && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "fastmcp[code-mode]==4.2.4" "pydantic-monty==1.6.0"
research/probes/fastmcp-codemode/run_all.sh
```

`probe_core.py` is the shared runner (identical in every wave-2 folder this worker owns); `adapter.py` is the FastMCP part. Each probe runs in its own child process, stopped at 120 s or 4 GB tree RSS; P7 holds `../mem-lock.sh`. Evidence: `out/<tag>.txt`. Extras: `stdio_print_check.py` (where print goes over stdio), `worker_check.py` (which process runs the code), `p11_breakdown.py` (cost of the per-call Monty pool). `meta.json` holds the source notes and display overrides that `collect` merges into `research/probes/results/fastmcp-codemode.json`.
