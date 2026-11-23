# smolagents-docker probes

`DockerExecutor` from smolagents 1.26.0 (`executor_type="docker"`). No LLM.

    cd research/impls/smolagents-docker && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "smolagents[docker]==1.26.0"
    cd research/probes/smolagents-docker && PY=../../impls/smolagents-docker/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh $PY harness.py P7
    $PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../mem-lock.sh $PY harness.py --hardened P7

The first run builds the image `smolagents-docker-jupyter-kernel` (about 80 s). Containers are named `smolagents-docker-[h-]<probe>`; the parent stops a probe at 120 s or 4 GiB container memory and removes the container. `HARDENED_NETWORK=none` adds `network_mode` to the hardened kwargs (it fails at setup; see `out/extra-network-none.txt`).
