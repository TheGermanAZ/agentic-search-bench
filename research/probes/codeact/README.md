# codeact probe harness

Probes P1 to P12 from `research/probes/SPEC.md`, run through the `PythonREPL` that CodeAct's agent environment uses
(`mint/envs/general_env.py:66-70`), at xingyaoww/code-act commit `d607f56c9cfe9e8632ebaf65dcaf2b4b7fe1c6f8`. No model, no GPU, no Docker.

## Rerun

```bash
cd research/impls/codeact && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ipython certifi
cd research/probes/codeact && ./run_all.sh
```

`run_all.sh` takes about a minute, mostly the 30 s P6 alarm. P7 stops at 4 GB of host RSS. Results go to `out/<P>.txt` (raw evidence), `out/<P>.json` (outcome), and `out/<P>.log` (full stdout, which includes the host-side `echo PWNED` from P12). The ipython version is the resolver's pick (9.18.1), because the repo's requirements.txt leaves it unpinned. The CA bundle path is set in `run_all.sh` because this Mac's default OpenSSL CA path is missing.

## Hardened run (RUBRIC)

The repo's containerized code execution engine (`scripts/chat/code_execution/jupyter.py`: `JupyterGatewayDocker` with `mem_limit='8g'`, `nano_cpus=2e9`, and `JupyterKernel.execute(timeout=60)`). Pulls `docker.io/xingyaoww/codeact-executor` (amd64 only, 7.45 GB compressed, 21.4 GB on disk). Writes `out/hardened-<P>.*`; P12 takes about 3 minutes because each spawn attempt hangs to the 60 s timeout under emulation.

```bash
cd research/impls/codeact && uv venv --python 3.12 .venv-engine && uv pip install --python .venv-engine/bin/python docker tornado
cd research/probes/codeact && PROBE_SECRET=s3cr3t ../../impls/codeact/.venv-engine/bin/python hardened.py P3 P4 P5 P6 P9 P12
PROBE_SECRET=s3cr3t ../mem-lock.sh ../../impls/codeact/.venv-engine/bin/python hardened.py P7
```
