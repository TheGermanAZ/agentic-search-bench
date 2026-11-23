#!/bin/sh
# Starts the Executor local server from the pinned clone on 127.0.0.1:4399 with the probe env.
SRC="$(cd "$(dirname "$0")/../../impls/executor/src" && pwd)"
cd "$SRC" || exit 1
[ -f ../server.pid ] && kill "$(cat ../server.pid)" 2>/dev/null && sleep 2
PROBE_SECRET=s3cr3t EXECUTOR_DISABLE_ANALYTICS=1 DO_NOT_TRACK=1 EXECUTOR_PORT=4399 \
  node --import ./scripts/local-dev.ts apps/local/server/src/main.ts >> ../server.log 2>&1 &
echo $! > ../server.pid
start=$(date +%s)
KEY=$(node -p 'require("./.local/dev/keys.json").apiKey')
until [ "$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY" http://127.0.0.1:4399/v1/apps)" = 200 ]; do sleep 0.5; done
echo "server pid $(cat ../server.pid) ready after $(( $(date +%s) - start ))s"
