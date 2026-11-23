# Pydantic AI Harness CodeMode probes

Pins: `pydantic-ai-harness[code-mode]==0.71.0` (pydantic-ai-slim 2.71.0, pydantic-monty 1.6.0). Source clone: `research/impls/pydantic-ai-harness-codemode/src`, pydantic/pydantic-ai tag v2.71.0 (8e4f468a), identical to the installed wheel. A scripted `FunctionModel` calls `run_code`; no LLM.

    cd research/impls/pydantic-ai-harness-codemode && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "pydantic-ai-harness[code-mode]==0.71.0"
    cd research/probes/pydantic-ai-harness-codemode && export PYDANTIC_AI_NO_BANNER=1 PY=../../impls/pydantic-ai-harness-codemode/.venv/bin/python
    $PY harness.py P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 X-print-cap X-tool-cap X-suspensions && ../mem-lock.sh $PY harness.py P7
    $PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../mem-lock.sh $PY harness.py --hardened P7

Outputs go to `out/<P>.txt|json` and `out/hardened-<P>.txt|json`. Each probe runs in a child process that the parent kills at 120 s or 4 GiB tree RSS.

Extra probes beyond SPEC: `X-print-cap` (11 MB print against the 10 MiB cap), `X-tool-cap` (101 calls against `max_tool_calls=100`), `X-suspensions` (12 snippets of 100 calls in one agent run against `max_suspensions=1000`). P12 runs every attempt twice, as the first snippet (ty type check on) and as a second snippet (type check skipped), so the runtime is tested too.
