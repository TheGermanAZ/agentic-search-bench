#!/usr/bin/env bash
# Starts the official Bifrost v2.6.0 image as container bifrost-codemode-verify on 127.0.0.1:42410 with
# verify/bifrost-codemode/<dir>/config.json (a copy of the worker's config with the tool server on port 42411).
# Same flags as research/probes/bifrost-codemode/start-bifrost.sh. Arg 1: data | data-hardened.
# Retries up to 3 times: under load the container sometimes exits at boot with
# "open /app/data/config.db: no such file or directory" right after the old db files are removed.
set -u
P=$(cd "$(dirname "$0")" && pwd)
NAME=bifrost-codemode-verify
DIR=${1:-data}
for attempt in 1 2 3; do
  rm -rf "$P/$DIR"/*.db "$P/$DIR"/*.db-* "$P/$DIR"/logs 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  sleep 1
  docker run -d --name "$NAME" --memory=4g --memory-swap=4g -p 127.0.0.1:42410:8080 -e PROBE_SECRET=s3cr3t -v "$P/$DIR":/app/data maximhq/bifrost:v2.6.0 >/dev/null || continue
  for i in $(seq 1 240); do
    curl -sf "http://127.0.0.1:42410/health" >/dev/null 2>&1 && exit 0
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "false" ] && break
    sleep 0.25
  done
  echo "start-gateway: attempt $attempt failed" >&2; docker logs "$NAME" 2>&1 | tail -3 >&2
done
exit 1
