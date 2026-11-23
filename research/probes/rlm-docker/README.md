# rlm-docker probes

RLM's `docker` environment (`DockerREPL`) at alexzhang13/rlm commit `e11f1a8` (rlm 0.1.3), image `python:3.11-slim`. No LLM.

    cd research/impls/rlm-docker && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ../rlm/repo
    cd research/probes/rlm-docker && PY=../../impls/rlm-docker/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh $PY harness.py P7

Each probe runs in a child process; the parent stops it at 120 s or 4 GiB container memory and removes the container `rlm-docker-<probe>`. `out/P2-model-view.txt` applies RLM's `format_iteration` to the P2 output. There is no hardened run: DockerREPL exposes no stricter option.
