# mcp-use-codemode probe harness

SPEC P1-P12 plus the hardened run against mcp-use 1.7.1 Python code mode (CodeModeConnector `execute_code`), no model. `host_server.py` is a stdio MCP server exposing `lookup` and counting calls in out/lookup-count.txt. Telemetry is disabled with MCP_USE_ANONYMIZED_TELEMETRY=false.

```bash
cd research/impls/mcp-use-codemode && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python mcp-use==1.7.1 psutil certifi
cd research/probes/mcp-use-codemode && ./run_all.sh && MCP_USE_ANONYMIZED_TELEMETRY=false ../../impls/mcp-use-codemode/.venv/bin/python collect.py
```

`closure_check.py` reproduces out/closure-check.txt (guest code reading the MCPClient config through a tool closure).
