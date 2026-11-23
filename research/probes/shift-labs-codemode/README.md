# shift-labs-codemode probe harness

Runs SPEC P1 to P12 and the RUBRIC hardened set against `@shiftlabs/codemode` at commit
`88de08941f62c52ecfde9f763ecb8bc8e8bad5b3`, through the public SDK (`Codemode.create`, `execute`).
The npm 0.46.0 tarball is an older commit, so `packages/codemode` was copied byte for byte to
`research/impls/shift-labs-codemode/core`, installed with `npm install --ignore-scripts`, and compiled with `tsc`.

## Rerun

```bash
cd ~/p/agentic-search-bench/research/impls/shift-labs-codemode/core && npm install --ignore-scripts && npx tsc -p tsconfig.json
cd ~/p/agentic-search-bench/research/probes/shift-labs-codemode && PROBE_SECRET=s3cr3t node run-probes.mjs default P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 && PROBE_SECRET=s3cr3t node run-probes.mjs hardened P3 P4 P5 P6 P9 P12 && P7_LITERAL_ONLY=1 ../mem-lock.sh node p7-runner.mjs default && P7_LITERAL_ONLY=1 ../mem-lock.sh node p7-runner.mjs hardened && python3 -I build-results.py
```

## Notes

- `lookup` is the action `host.lookup` (actions are always `plugin.action`).
- `p7-runner.mjs` runs P7 in a child process, samples the child tree's RSS every 100 ms, and kills only that child at 4 GB or 120 s. P7 is nondeterministic at the 64 MB default: the trial folders `out/P7-literal-trials/` (24 runs, 7 host aborts) and `out/P7-trials/` (12 runs with an extra variant, 6 aborts) came from looping the runner under one `mem-lock.sh` call.
- `find-min-mem.mjs` shows no worker starts below 12 MB, which is why the hardened run uses 16 MB.
- `build-results.py` holds hand-written detail strings from the reviewed `out/` files; recheck them after a rerun.
- P5 checks the host environment through `ps eww` on the shared PID and returns only a boolean.
