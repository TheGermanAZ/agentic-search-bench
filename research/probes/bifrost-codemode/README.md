# bifrost-codemode probe harness

Runs the official `maximhq/bifrost:v2.6.0` image with `data/config.json` (one code-mode MCP client `probe` and one local virtual key), then drives `executeToolCode` over Bifrost's `/mcp` endpoint.

```sh
cd research/probes/bifrost-codemode && npm install && (LOOKUP_COUNT_FILE=$PWD/out/lookup-count.log node ../docker-mcp-gateway-codemode/lib/lookup-server.mjs http 41411 &) \
  && ./start-bifrost.sh data && node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out "" P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && ../mem-lock.sh node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out "" P7 \
  && ./start-bifrost.sh data-hardened && node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out hardened- P3 P4 P5 P6 P9 P12 && ../mem-lock.sh node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out hardened- P7
```

`config-p7b.mjs` holds the low-step allocation variants (`out/P7b-P7.txt`). `tools/write-results.py` writes `research/probes/results/bifrost-codemode.json`.
The published benchmark lives in `research/impls/bifrost-codemode/bench` (maximhq/bifrost-benchmarking 3cb72a9); it was read, not run (needs an Anthropic key and about ten third-party accounts).
