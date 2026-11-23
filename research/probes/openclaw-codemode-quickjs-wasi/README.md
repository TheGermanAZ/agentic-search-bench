# openclaw-codemode-quickjs-wasi probe harness

Same harness as `../openclaw-codemode-node-vm` (shared `probe.mjs`, install and source clone), with `ENGINE=quickjs`, which sets `tools.codeMode.executor = "quickjs"` (bundled `code-mode-quickjs` plugin, QuickJS-WASI). Outputs land in `out/` here.

```sh
research/probes/openclaw-codemode-node-vm/run.sh quickjs
```
