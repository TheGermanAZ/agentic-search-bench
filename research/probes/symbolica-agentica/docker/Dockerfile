# Builds agentica-server (pinned clone) with its Wasm sandbox: wasi-sdk 27 + CPython 3.12 WASI
# guest via componentize-py, and the Rust wasmtime host (PyO3/maturin). Build context:
# research/impls/symbolica-agentica
FROM rust:1-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates perl && rm -rf /var/lib/apt/lists/*
ENV UV_LINK_MODE=copy SETUPTOOLS_SCM_PRETEND_VERSION=0.4.1
COPY agentica-server /opt/agentica-server
WORKDIR /opt/agentica-server
RUN uv sync 2>&1 | tail -n 200
# use the venv directly: `uv run` would re-sync and rebuild the project
ENV PYTHONPATH=/opt/agentica-server/src
RUN ls -la src/sandbox/env.wasm && .venv/bin/python -c "import host, sandbox; print('host ok', host.WasmRunner)"
# precompile the component once (writes src/sandbox/host/env.wasm.compiled) so probes measure warm loads
COPY warmup.py /opt/warmup.py
RUN cd src && /opt/agentica-server/.venv/bin/python /opt/warmup.py && ls -la sandbox/host/env.wasm.compiled
