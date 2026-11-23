# openclaw-codemode-node-vm probe harness

Drives OpenClaw Code Mode's model-facing `exec`/`wait` tools (from `createCodeModeTools` + `applyCodeModeCatalog` in the published `openclaw@2026.11.6` dist) with fixed code and a `lookup` tool. No model and no Gateway: OpenClaw HOME/state/config point at `./state`.

```sh
cd research/impls/openclaw-codemode-node-vm && mkdir -p npm && cd npm && echo '{"private":true}' > package.json && npm install --ignore-scripts openclaw@2026.11.6
research/probes/openclaw-codemode-node-vm/run.sh node      # quickjs: run.sh quickjs
```

- `probe.mjs`: probes and driver. Env: `ENGINE=node|quickjs`, `HARDENED=1`, `WARM_HOST=1` (cells run in a bound Gateway resource host so workers are reused; used for P11), `OUT=<dir>`.
- `out/`: raw outputs (`P*.txt` default, `hardened-*`, `warm-*`; `rerun1/`, `rerun2/` repeat hardened P6).
- `summarize.py`: compact view of an output file. `write-results.py`: writes `research/probes/results/openclaw-codemode-{node-vm,quickjs-wasi}.json`.
- Source read at tag v2026.11.6 (06afb10d) in `research/impls/openclaw-codemode-node-vm/src`.
