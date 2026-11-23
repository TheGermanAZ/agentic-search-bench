# autogen-local probe harness

SPEC P1-P12 plus the RUBRIC hardened run against AutoGen's LocalCommandLineCodeExecutor (autogen-ext 0.7.5) with `functions=[lookup]`, no model.

```bash
cd research/impls/autogen-local && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "autogen-ext[docker]==0.7.5" autogen-core==0.7.5 psutil certifi
cd research/probes/autogen-local && ./run_all.sh && ../../impls/autogen-local/.venv/bin/python collect.py
```

`core.py` is the shared driver, `adapter.py` wires the executor (MODE="local"), `meta.py` holds source notes. Source clone: research/impls/autogen-local/src (microsoft/autogen @ 8390985). `orphan_check.py` reproduces out/P6-orphan.txt (timeout extended by a child holding stdout).
