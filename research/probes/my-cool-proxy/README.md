# my-cool-proxy probe harness

```sh
cd research/impls/my-cool-proxy/npm && npm install @karashiiro/my-cool-proxy@1.6.2
cd ../../../probes/my-cool-proxy && npm install && (LOOKUP_COUNT_FILE=$PWD/out/lookup-count.log node ../docker-mcp-gateway-codemode/lib/lookup-server.mjs http 41421 &) \
  && ./start-proxy.sh && node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out "" P1 P2 P3 P4 P5 P8 P9 P10 P11 P12 \
  && NO_RESET=1 node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out "" P6 && ./start-proxy.sh && NO_RESET=1 ../mem-lock.sh node ../docker-mcp-gateway-codemode/lib/mcp-probe.mjs config.mjs out "" P7
```

Extra checks: `config-p12b.mjs` and `config-p12c.mjs` (proxied JS objects), `node pollute.mjs` (cross-session Object.prototype write; restart the proxy after), `node stdio-inject.mjs` (print() on the stdio transport).
`start-proxy.sh` points HOME and XDG dirs at `./home`. `tools/write-results.py` writes the results JSON.
