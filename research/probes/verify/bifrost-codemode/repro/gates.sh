#!/usr/bin/env bash
# Gate probes only (P3 P4 P5 P6 P7 P9 P12), default then hardened. Copies of the worker's config.mjs,
# start-bifrost.sh and docker-mcp-gateway-codemode/lib/*.mjs with only the container name
# (bifrost-codemode-verify-gates), ports (gateway 42412, lookup server 42413 on 127.0.0.1) adjusted.
set -u
cd "$(dirname "$0")"
LOOKUP_COUNT_FILE=$PWD/out/lookup-count.log node lib/lookup-server.mjs http 42413 > out/lookup-server.log 2>&1 &
LS=$!
sleep 1
./start-bifrost.sh data
node lib/mcp-probe.mjs config.mjs out "" P3 P4 P5 P6 P9 P12
../../../mem-lock.sh node lib/mcp-probe.mjs config.mjs out "" P7
./start-bifrost.sh data-hardened
node lib/mcp-probe.mjs config.mjs out hardened- P3 P4 P5 P6 P9 P12
../../../mem-lock.sh node lib/mcp-probe.mjs config.mjs out hardened- P7
kill $LS
docker rm -f bifrost-codemode-verify-gates > /dev/null
