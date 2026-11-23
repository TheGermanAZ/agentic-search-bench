# tanstack-ai-codemode-cloudflare probe harness

Runs the SPEC probes against TanStack AI Code Mode (`@tanstack/ai-code-mode` 1.1.2 with
`@tanstack/ai-isolate-cloudflare` 1.1.x; source at TanStack/ai `c695ada5091e7022bf13b235220645ceb65d43b0`,
identical to the npm `src` folders). The engine is the package's ready-made Worker under local `wrangler dev` 4.166.0 (workerd), which loads each program into a fresh isolate with the Worker Loader binding.

`probe.mjs` builds the tool with `createCodeModeTool({ driver, tools: [lookup, failing] })` and calls the
tool's `execute({ typescriptCode })`, which is what `chat()` calls after a model tool call. Tools become
`external_lookup` and `external_failing` inside the sandbox. The hardened run passes the public options
`timeout: 5000` and `memoryLimit: 32`. No Cloudflare account or login is needed. `run-all.sh` starts `wrangler dev` on 127.0.0.1:41010 with `WRANGLER_SEND_METRICS=false`, and stops only the wrangler process it started. P6 and P7 each get a fresh wrangler session. `WATCH_EXTRA_PID` makes `watch.mjs` also sample the workerd process's RSS.

## Rerun

```bash
(cd ../../impls/tanstack-ai-codemode-cloudflare/pkg && npm ci --ignore-scripts)
./run-all.sh                                   # every probe, default then hardened
node watch.mjs P9 node probe.mjs P9              # one probe
```

`watch.mjs` runs one probe in a child process, samples RSS with `ps` every 50 ms, kills at 4 GB or 120 s,
and writes `out/<label>.txt` and `out/<label>.json`. P6 and P7 also start a second program 100 ms in and a
third one afterwards, to show whether other sessions survive. The same `probe.mjs` runs in every
`tanstack-ai-codemode-*` folder; only the `DRIVER` constant differs.
