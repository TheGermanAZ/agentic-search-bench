# qwen-code-codemode probe harness

Runs the released Qwen Code CLI (`@qwen-code/qwen-code@0.28.4`, installed locally in `research/impls/qwen-code-codemode/npm`, source clone at tag v0.28.4 in `research/impls/qwen-code-codemode/src`) headless with `tools.codeModeOnly: true`. A scripted OpenAI-compatible mock on 127.0.0.1:42101 (inside `driver.mjs`, no model) answers each model request with one `exec` tool call carrying a fixed probe source, and reads the exec result from the next request. `lookup` is a local stdio MCP server (`lookup-server.mjs`, trusted in settings). HOME and QWEN_HOME point at `home/<config>/`, so no global Qwen config is read or written.

```sh
cd research/probes/qwen-code-codemode && npm install && (cd ../../impls/qwen-code-codemode/npm && npm install --ignore-scripts) \
  && for p in P1 P2 P3 P4 P5 P6 P6b P6c P8 P9 P10 P11 P12; do node driver.mjs default $p; done && LOOKUP_READ_ONLY=1 node driver.mjs default P9 \
  && WATCH_RSS=1 ../mem-lock.sh node driver.mjs default P7 && node driver.mjs default P7after
for p in P1 P3 P4 P5 P6 P6c P9 P12; do node driver.mjs hardened $p; done && LOOKUP_READ_ONLY=1 node driver.mjs hardened P9 && WATCH_RSS=1 ../mem-lock.sh node driver.mjs hardened P7
```

- Probe sources: `probes.mjs`. Configs: `settings.<config>.json` plus CLI flags in `args.<config>.json`.
- `NET_WATCH=1` records every remote socket of the CLI process tree (only 127.0.0.1:42101 was seen).
- `host-direct.mjs` drives the bundled `codeModeHost.js` over its framed stdio protocol without the CLI: `node host-direct.mjs p11` (P11 cost of the runtime alone) and `../mem-lock.sh node host-direct.mjs once "<src>"` (P7 variants).
- `memcheck/` reproduces the memory-limit gap with the same QuickJS library versions alone: `cd memcheck && npm install && ../../mem-lock.sh node memcheck.mjs`.
- Raw outputs are in `out/`.
