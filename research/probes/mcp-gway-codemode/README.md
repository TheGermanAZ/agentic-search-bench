# mcp-gway-codemode probe harness

mcp-gway 6.9.2 (venv in `research/impls/mcp-gway-codemode/.venv`, source at tag v6.9.2 in `research/impls/mcp-gway-codemode/src`).
`home/` is the gateway's HOME (registry with one stdio upstream `Probe` = `node lookup-server.mjs stdio`). `probe.py` sends raw
JSON-RPC `tools/call executeTool` to `POST /mcp` and saves the whole response under `out/`.

```sh
cd research/probes/mcp-gway-codemode && npm ci   # lookup-server deps; registry already in home/ (made with `mcp-gway add Probe --type local ...`)
# default (P6 and P7 freeze the gateway: restart it after each with a new port)
PID=$(./start-gw.sh 42160) && sleep 3 && python3 -I probe.py 42160 $PID "" LIST P1 P2 P3 P4 P5 P8 P9 P10 P11 P12 X1 X2 X3 && python3 -I probe.py 42160 $PID "" P6; kill -9 $PID
PID=$(./start-gw.sh 42161) && sleep 3 && ../mem-lock.sh python3 -I probe.py 42161 $PID "" P7; kill -9 $PID
# hardened: published image with docker-compose.prod.yml limits + MCP_GWAY_EXEC_TIMEOUT=1, MCP_GWAY_MAX_RESULT_BYTES=1024
./start-container.sh && sleep 15 && GW_CONTAINER=mcp-gway-codemode-hardened python3 -I probe.py 42165 0 hardened-container- LIST P1 P3 P4 P5 P9 P12 X2 P6
./start-container.sh && sleep 15 && GW_CONTAINER=mcp-gway-codemode-hardened ../mem-lock.sh python3 -I probe.py 42165 0 hardened-container- P7; docker rm -f mcp-gway-codemode-hardened
```

`./start-gw.sh <port> hardened` runs the same env knobs on the host (`out/hardened-*.txt`). `gil-check.py` / `gil-control.py`
(run with the venv's python) show that starlark-pyo3 holds the GIL during eval (`out/gil-check.txt`). Extra probes: X1 cross-request
log leak, X2 caller-chosen timeout, X3 host-side callManyTool. The default P7 sampler used RSS, which macOS compression kept under 4 GB
while phys_footprint reached 56 GB (`out/P7-after.txt`); later runs sample phys_footprint.
