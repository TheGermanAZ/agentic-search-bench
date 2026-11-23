# docker-mcp-gateway-codemode probe harness

Build the gateway from source (once), start the lookup server and gateway, run every probe:

```sh
docker run --rm -v "$PWD/research/impls/docker-mcp-gateway-codemode/src":/src:ro -v "$PWD/research/impls/docker-mcp-gateway-codemode/bin":/out -w /src -e CGO_ENABLED=0 -e GOFLAGS=-mod=vendor -e GOCACHE=/tmp/gocache golang:1.26 go build -trimpath -ldflags "-s -w" -o /out/docker-mcp ./cmd/docker-mcp
cd research/probes/docker-mcp-gateway-codemode && npm install && (LOOKUP_COUNT_FILE=$PWD/out/lookup-count.log node lib/lookup-server.mjs http 41401 &) && ./start-gateway.sh --static && node lib/mcp-probe.mjs config.mjs out "" P1 P2 P3 P4 P5 P8 P9 P10 P11 P12 && NO_RESET=1 node lib/mcp-probe.mjs config.mjs out "" P6 && ./start-gateway.sh --static && NO_RESET=1 ../mem-lock.sh node lib/mcp-probe.mjs config.mjs out "" P7
```

Stdio transport checks: `node lib/mcp-probe.mjs config-stdio.mjs out stdio- P1 P2` and `node stdio-inject.mjs`.
`lib/` (lookup MCP server and generic MCP probe driver) is shared with the bifrost-codemode, agentgateway-codemode and my-cool-proxy harnesses.
`tools/write-results.py` writes `research/probes/results/docker-mcp-gateway-codemode.json`.
