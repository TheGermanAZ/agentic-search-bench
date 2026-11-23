# smolagents-local probe harness

Probes P1 to P12 from `research/probes/SPEC.md`, run through `LocalPythonExecutor` (smolagents 1.26.0) with no model in the loop.

## Rerun

```bash
cd research/impls/smolagents-local && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python smolagents==1.26.0
cd research/probes/smolagents-local && ./run_all.sh && python3 collect.py
```

`run_all.sh` runs each probe in its own process. It takes about a minute, mostly the 35 s P6b sleep. P7 holds up to 4 GB of host RSS while it runs. Results go to `out/<P>.txt` (raw evidence) and `out/<P>.json` (outcome). `collect.py` writes `research/probes/results/smolagents-local.json`.

Hardened run (RUBRIC): `LocalPythonExecutor(additional_authorized_imports=[], timeout_seconds=5)`; `HARDENED_TIMEOUT_S=1` reproduces `out/extra-timeout1-*`. Writes `out/hardened-<P>.*`:

    for p in P3 P4 P5 P6 P9 P12; do PROBE_SECRET=s3cr3t ../../impls/smolagents-local/.venv/bin/python hardened.py $p; done
    PROBE_SECRET=s3cr3t ../mem-lock.sh ../../impls/smolagents-local/.venv/bin/python hardened.py P7
