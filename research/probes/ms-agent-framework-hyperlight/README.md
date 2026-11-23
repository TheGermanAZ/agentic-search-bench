# ms-agent-framework-hyperlight probe harness

SPEC P1-P12 plus the hardened run against HyperlightExecuteCodeTool (agent-framework-hyperlight 1.0.0b261112), no model.

The documented install does not run on macOS (out/attempt-macos-documented.txt). The probes use hyperlight-sandbox 0.10.0, which ships macOS arm64 wheels, overriding the package's `<0.10` pin:

```bash
cd research/impls/ms-agent-framework-hyperlight && uv venv --python 3.12 .venv-hl010 && uv pip install --python .venv-hl010/bin/python --prerelease=allow --override overrides-hl010.txt agent-framework-hyperlight==1.0.0b261112 hyperlight-sandbox-backend-wasm==0.10.0 psutil
cd research/probes/ms-agent-framework-hyperlight && ./run_all.sh && ../../impls/ms-agent-framework-hyperlight/.venv-hl010/bin/python collect.py
```

`attempt.py` is the one-shot install check. Diagnostic reruns with include_detailed_errors=True: `HL_DETAILED=1 PROBE_PREFIX=diag- <py> core.py P2 P3 P4 P10 P12 PX` (P7 through ../mem-lock.sh). `mem_size.py` writes out/P7-size.txt. Source was read from the PyPI sdist in research/impls/ms-agent-framework-hyperlight/pkg/.
