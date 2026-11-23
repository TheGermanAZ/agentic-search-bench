# stainless-mcp-codemode probe harness

Runs SPEC P1 to P12 plus extras against the Stainless-generated Mux MCP server, `@mux/mcp` 16.2.0 from npm
(installed in `research/impls/stainless-mcp-codemode/npm`; source clone of muxinc/mux-node-sdk at
`6037f04ae022ecac0bb6f986a35db66338b17ea3` in `research/impls/stainless-mcp-codemode/repo`).
The harness starts the server over stdio with local Deno execution (`DENO_PATH=/opt/homebrew/bin/deno`) and calls `execute`.
No Mux key is used: `MUX_BASE_URL` points the SDK at a mock Mux API served by the harness on 127.0.0.1:41320,
whose `GET /video/v1/assets/:id` plays the SPEC `lookup` role; `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` are dummy strings.

```bash
(cd research/impls/stainless-mcp-codemode/npm && npm install --omit=optional --ignore-scripts @mux/mcp@16.2.0)   # once
cd research/probes/stainless-mcp-codemode
export DENO_DIR=$PWD/../../impls/stainless-mcp-codemode/deno-dir
R="deno run -A --no-config --node-modules-dir=none run-probes.ts"
$R default TOOLS P1 P1b P2 P3 P4 P4b P4c P5 P5b P8 P9 P10 P10b P11 P12a P12b P12c P12d P12e X1 X2 X3
$R default P6            # 120 s; the harness then kills the worker, which also ends the MCP server
$R default P6kill        # same crash, reproduced in 8 s
../mem-lock.sh $R default P7
$R hardened P1 P3 P4 P4b P5 P5b P9 P12a P12b P12c P12d P12e H1 H2
$R hardened P6
../mem-lock.sh $R hardened P7
```

Hardened adds `--code-allow-http-gets --no-client-header-overrides`. P6 and P7 end the server process, so
run them in their own invocations. `out/mock-log.txt` (appended per run) records every request the sandbox made
to the mock API. The results JSON was written by hand from the `out/` files.
