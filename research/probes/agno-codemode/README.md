# agno-codemode probe harness

SPEC P1 to P12 plus the RUBRIC hardened run against Agno's `CodeMode` toolkit (agno 3.2.1 `[code]`): `CodeMode(tools=[lookup])`, each execution awaiting the model-facing `CodeMode.aexecute(RunContext, code)`. No LLM. `AGNO_TELEMETRY=false`.

CodeMode is **not a sandbox** (its own docstring says so): the probes really read `/etc/hosts`, see `PROBE_SECRET`, reach example.com, write a file under `out/`, and run `echo` through the shell.

```bash
cd research/impls/agno-codemode && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "agno[code]==3.2.1"
research/probes/agno-codemode/run_all.sh
```

`probe_core.py` is the shared wave-2 runner (copied from `fastmcp-codemode`); `adapter.py` is the Agno part (hardened = `timeout=10, allow_shell=False, allow_restart=False, snapshot=False, on_busy_kernel="restart"`). Extras: `Pcap` (100,000-char print), `Pwrite` (write and delete a file in `out/`), `Pshell` (`!echo`). Side checks: `p6_default_check.py` (the default 300 s timeout really fires; about 5 minutes), `swallow_check.py` (a cell that catches KeyboardInterrupt outlives the timeout; `out/swallow_check.txt` was taken with `on_busy_kernel="wait"`, the default, before the hardened config gained `"restart"`).
