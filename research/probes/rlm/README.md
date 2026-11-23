# rlm probe harness

Probes P1 to P12 from `research/probes/SPEC.md`, plus an extra `CTX` probe (corpus exposure) and `P9b` (threaded calls),
run directly through `LocalREPL.execute_code()` from alexzhang13/rlm at commit `e11f1a8f8ee4490686e16dd6463233abe08a07eb`
(rlm 0.1.3). The `RLM` class is never constructed, so no model client is needed. `lm_handler_address` is None and
`llm_query` is replaced with a stub that counts calls.

## Rerun

```bash
cd research/impls/rlm && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python /abs/path/to/research/impls/rlm/repo
cd research/probes/rlm && ./run_all.sh
```

The clone is at `research/impls/rlm/repo`. `run_all.sh` takes about 2.5 minutes. P6 is an infinite loop, and the harness stops it at 120 s. P7 stops at 4 GB peak RSS. The suite also writes `out/<P>.log` with full stdout. The CA bundle is set in `run_all.sh` because this Mac's default OpenSSL CA path is missing, which made P3 fail with a certificate error before the fix.

## Hardened run (RUBRIC)

`environment="ipython"` with `kernel_mode="subprocess"`, `cell_timeout=30` (the IPython environment docs). Needs the `ipython` extra in a second venv. Writes `out/hardened-<P>.*`:

```bash
cd research/impls/rlm && uv venv --python 3.12 .venv-ipython && uv pip install --python .venv-ipython/bin/python "$(pwd)/repo[ipython]" certifi
cd research/probes/rlm && for p in P3 P4 P5 P6 P9 P12; do ../../impls/rlm/.venv-ipython/bin/python hardened.py $p; done
../mem-lock.sh ../../impls/rlm/.venv-ipython/bin/python hardened.py P7
```
