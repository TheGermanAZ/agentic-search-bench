# opencode-codemode probe harness

Setup once (clone the pinned tag and install the core workspace with the repo's Bun 1.4.4):

```bash
git clone --depth 1 --branch v2.3.2 https://github.com/anomalyco/opencode.git research/impls/opencode-codemode/src
(cd research/impls/opencode-codemode/src && bun install --ignore-scripts --filter '@opencode/core' --filter '@opencode/codemode')
```

Run one probe (`run.sh` copies `harness.ts` into `packages/core/probe/` so workspace imports resolve):

```bash
research/probes/opencode-codemode/run.sh <default|deny|hardened> <P1..P12> > research/probes/opencode-codemode/out/<P>.txt
research/probes/mem-lock.sh research/probes/opencode-codemode/rss-guard.sh research/probes/opencode-codemode/out/P7.txt research/probes/opencode-codemode/run.sh default P7
```

Modes: `default` is OpenCode's own `execute` tool (`CodeModeTool.create`, fetch on, no limits) with the documented base permission policy; `deny` adds a `webfetch` deny rule; `hardened` is `CodeMode.make({ tools, limits: { timeoutMs: 30000, maxToolCalls: 20, maxOutputBytes: 32768 } })` with no extensions. `out/session-data/` holds the files OpenCode's session truncation wrote during P2.
