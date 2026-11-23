# mcp-use-codemode-ts probe harness

SPEC P1-P12 (plus P6b, a loop after an await) and the hardened run against @mcp-use/client 2.4.6 code mode (VMCodeExecutor through the CodeModeConnector), no model. `run.mjs` runs `probe.mjs` once per probe in a child Node process and kills it at 4 GB RSS or 120 s. The lookup MCP server is `host_server.py`, run with the mcp-use-codemode Python venv.

```bash
cd research/impls/mcp-use-codemode-ts && npm install --ignore-scripts @mcp-use/client@2.4.6   # also needs research/impls/mcp-use-codemode/.venv (see that README)
cd research/probes/mcp-use-codemode-ts && ./run_all.sh && ../../impls/mcp-use-codemode/.venv/bin/python collect.py
```
