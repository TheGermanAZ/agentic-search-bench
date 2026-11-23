# vercel-run probe harness

Runs the SPEC probes against Vercel Run (npm `run` 2.1.13, repo vercel-labs/run at
`6c146567b19d96b4164550314875ed55eb2366ce`) through its public API: `run()` for the default
configuration and `createRunner({ limits })` for the hardened one (the budget from the package's own
`content/docs/advanced/limits.mdx` example).

## Rerun

```bash
(cd ../../impls/vercel-run/pkg && npm ci --ignore-scripts)   # or: npm i run@2.1.13 --ignore-scripts
./run-all.sh                     # every probe; P6 takes about 10 s, hardened P6 about 5 s
node watch.mjs P9 node probe.mjs P9            # one probe
node watch.mjs hardened-P6 node probe.mjs P6 --hardened
```

`watch.mjs` runs one probe in a child process, samples its RSS with `ps` every 50 ms, kills it at 4 GB or
120 s, and writes `out/<label>.txt` (the probe record, plus the child's raw stdout and stderr). Guest
`console.log` output appears in that stdout section, because Run writes it straight to the host process's
file descriptor 1. `probe.mjs` also writes `out/<label>.json`. P6 and P7 also run a second, concurrent
program and a third one afterwards, to show whether other sessions survive.

The host tool is a host function group `host` with `lookup`, so guest code calls `host.lookup({id})`.
Run has no top-level host functions; every function lives in a named group.
