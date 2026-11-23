# autogen-docker probe harness

SPEC P1-P12 plus the RUBRIC hardened run against AutoGen's DockerCommandLineCodeExecutor (autogen-ext 0.7.5) with `functions=[lookup]`, no model. Needs Docker; containers are named autogen-docker-probe-<id> and auto-removed; the image python:3-slim is pulled on first run.

```bash
cd research/impls/autogen-docker && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "autogen-ext[docker]==0.7.5" autogen-core==0.7.5 psutil certifi
cd research/probes/autogen-docker && ./run_all.sh && ../../impls/autogen-docker/.venv/bin/python collect.py
```

`core.py` is the shared driver, `adapter.py` wires the executor (MODE="docker"), `meta.py` holds source notes. Source clone: research/impls/autogen-local/src (microsoft/autogen @ 8390985), symlinked here as src.
