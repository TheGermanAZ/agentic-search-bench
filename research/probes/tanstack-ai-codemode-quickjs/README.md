# tanstack-ai-codemode-quickjs probe harness

Runs the SPEC probes against TanStack AI Code Mode (`@tanstack/ai-code-mode` 1.1.2 with
`@tanstack/ai-isolate-quickjs` 1.1.x; source at TanStack/ai `c695ada5091e7022bf13b235220645ceb65d43b0`,
identical to the npm `src` folders). The engine is quickjs-emscripten 0.31.0 (QuickJS WASM, sync build, on the host main thread).

`probe.mjs` builds the tool with `createCodeModeTool({ driver, tools: [lookup, failing] })` and calls the
tool's `execute({ typescriptCode })`, which is what `chat()` calls after a model tool call. Tools become
`external_lookup` and `external_failing` inside the sandbox. The hardened run passes the public options
`timeout: 5000` and `memoryLimit: 32`. 

## Rerun

```bash
(cd ../../impls/tanstack-ai-codemode-quickjs/pkg && npm ci --ignore-scripts)
./run-all.sh                                   # every probe, default then hardened
node watch.mjs P9 node probe.mjs P9              # one probe
```

`watch.mjs` runs one probe in a child process, samples RSS with `ps` every 50 ms, kills at 4 GB or 120 s,
and writes `out/<label>.txt` and `out/<label>.json`. P6 and P7 also start a second program 100 ms in and a
third one afterwards, to show whether other sessions survive. The same `probe.mjs` runs in every
`tanstack-ai-codemode-*` folder; only the `DRIVER` constant differs.
