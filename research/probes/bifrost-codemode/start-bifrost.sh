#!/usr/bin/env bash
# Starts the official Bifrost v2.6.0 image with data/<config dir> mounted as APP_DIR. Arg 1: config dir name (default data).
set -eu
P=$(cd "$(dirname "$0")" && pwd)
NAME=${BF_NAME:-bifrost-codemode-gw}
DIR=${1:-data}
rm -f "$P/$DIR"/*.db "$P/$DIR"/*.db-* 2>/dev/null || true
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --memory=4g --memory-swap=4g -p 127.0.0.1:${BF_PORT:-41410}:8080 -e PROBE_SECRET=s3cr3t -v "$P/$DIR":/app/data maximhq/bifrost:v2.6.0 >/dev/null
for i in $(seq 1 120); do curl -sf "http://127.0.0.1:${BF_PORT:-41410}/health" >/dev/null 2>&1 && exit 0; sleep 0.5; done
docker logs "$NAME" 2>&1 | tail -30; exit 1
