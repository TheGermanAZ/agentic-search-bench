#!/usr/bin/env bash
# Starts the from-source gateway in a throwaway container. Extra args are appended to "gateway run".
set -eu
P=$(cd "$(dirname "$0")" && pwd); I=$P/../../impls/docker-mcp-gateway-codemode
NAME=${GW_NAME:-docker-mcp-gateway-codemode-gw}
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --memory=4g --memory-swap=4g -p 127.0.0.1:${GW_PORT:-41400}:41400 \
  -e DOCKER_MCP_IN_CONTAINER=1 -e HOME=/home/probe -e PROBE_SECRET=s3cr3t -e MCP_GATEWAY_AUTH_TOKEN=probetoken -e DOCKER_MCP_ALLOW_INSECURE_REMOTE_URLS=1 \
  -v "$I/bin":/gw:ro -v "$P/home":/home/probe \
  node:22-slim /gw/docker-mcp gateway run --catalog /home/probe/.docker/mcp/catalogs/probe.yaml --enable-all-servers \
  --transport streaming --port 41400 --host 0.0.0.0 --secrets /home/probe/empty.env --verbose "$@"
for i in $(seq 1 60); do docker logs "$NAME" 2>&1 | grep -q "Start streaming server" && exit 0; sleep 0.5; done
docker logs "$NAME" 2>&1 | tail -30; exit 1
