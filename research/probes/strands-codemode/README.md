# strands-codemode probe harness

SPEC P1 to P12 plus the RUBRIC hardened run against the Strands harness `programmatic_tool_caller` (strands-harness 0.4.0, Monty 0.0.23 in a worker process). A real `create_harness(...)` agent with a stub model; each execution is `agent.tool.programmatic_tool_caller(code=...)`. No LLM.

```bash
cd research/impls/strands-codemode && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "strands-harness==0.4.0"
research/probes/strands-codemode/run_all.sh
```

`probe_core.py` is the shared wave-2 runner (copied from `fastmcp-codemode`); `adapter.py` is the Strands part. Each probe runs in its own child process, stopped at 120 s or 4 GB tree RSS; P7 holds `../mem-lock.sh`. Evidence: `out/<tag>.txt`. `meta.json` holds source notes and display overrides that `collect` merges into `research/probes/results/strands-codemode.json`.

Side checks (run with the venv python): `worker_check.py` (the guest runs in a `monty subprocess` child; session survives MemoryError; run it under `../mem-lock.sh`), `timeout_check.py` (worker stops when the hardened wall-clock timeout fires), `orphan_check.py` (`EXIT_MODE=os_exit` shows an orphaned worker spinning until the 60 s VM limit). Outputs in `out/*_check.txt`.
