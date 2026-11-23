#!/usr/bin/env bash
# Hardened container run: the project's published image with the limits and flags of its own
# docker-compose.prod.yml (memory 256m, cpus 0.5, read_only, tmpfs, cap_drop ALL, no-new-privileges),
# plus MCP_GWAY_EXEC_TIMEOUT=1 and MCP_GWAY_MAX_RESULT_BYTES=1024. Host port 42165.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
docker rm -f mcp-gway-codemode-hardened >/dev/null 2>&1 || true
docker run -d --name mcp-gway-codemode-hardened --platform linux/amd64 \
  --memory 256m --cpus 0.5 --read-only --tmpfs /tmp:size=64m --tmpfs /home/gateway/.cache:size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e MCP_GWAY_ALLOW_REMOTE=1 -e MCP_GWAY_ALLOW_LOCAL_COMMANDS=python -e MCP_GWAY_LOG_TO_FILE=0 \
  -e MCP_GWAY_EXEC_TIMEOUT=1 -e MCP_GWAY_MAX_RESULT_BYTES=1024 -e PROBE_SECRET=s3cr3t \
  -v "$HERE/container/servers:/home/gateway/.config/mcp-gway/servers" \
  -v "$HERE/container:/probe:ro" -v "$HERE/out:/probe-out" \
  -p 127.0.0.1:42165:8080 \
  ghcr.io/deuriib/mcp-gway@sha256:3471b4784f3c3a882d9ea32d277ce499623b87421578cd4609cca99cf5955b18 >/dev/null
echo mcp-gway-codemode-hardened
