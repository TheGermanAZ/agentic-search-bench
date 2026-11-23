# langchain-quickjs probes

Probes `CodeInterpreterMiddleware` from `langchain-quickjs==0.4.0` (deepagents tag `langchain-quickjs==0.4.0`, commit `3285b5cac24ea0d6375f256312267685d3dbcd5a`) with `quickjs-rs==0.3.0`. Pinned versions are in `research/impls/langchain-quickjs/requirements.lock.txt`.

Each probe runs through a real `langchain.agents.create_agent` agent with the middleware, the `lookup` tool on `ptc=["lookup"]`, and an `InMemorySaver` checkpointer. A scripted chat model turns each human message into one `eval` tool call with that exact code, so no LLM is involved. The tool output in `out/` is the `ToolMessage` text the model would see.

Rerun everything (default P1 to P12, hardened P3 to P9 and P12, P7 through `../mem-lock.sh`):

```bash
cd research/probes/langchain-quickjs
../../impls/langchain-quickjs/.venv/bin/python run_all.py both
PROBE_SECRET=s3cr3t ../../impls/langchain-quickjs/.venv/bin/python extras.py
```

`run_all.py both P6` runs one probe. `harness.py <default|hardened> <Pn>` runs one probe with no monitor and needs `PROBE_SECRET=s3cr3t` in the environment.

Rebuild the venv if it is missing:

```bash
cd research/impls/langchain-quickjs
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.lock.txt
```

Files:

- `harness.py` runs one probe and writes `out/<Pn>.txt` or `out/hardened-<Pn>.txt`.
- `run_all.py` runs each probe in a fresh process, samples process RSS every 50 ms, kills at 120 s or 4 GB, and appends a `monitor:` line.
- `extras.py` checks source claims the SPEC probes do not cover and writes `out/extras.txt`.
