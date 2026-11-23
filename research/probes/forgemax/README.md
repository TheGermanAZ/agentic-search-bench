# forgemax probe harness

Runs SPEC P1 to P12 plus extras against the Forgemax v0.6.1 release binary
(`research/impls/forgemax/bin`, from `forgemax-v0.6.1-macos-aarch64.tar.gz`, checksum verified; source
at tag commit `b042a44cee20afe18db905ee4282b3e3db52e88b` in `research/impls/forgemax/repo`).
The harness starts `forgemax serve` over stdio, connects as an MCP client, and calls `execute`.
`lookup-server.ts` is the SPEC host tool as a stdio MCP server; it logs each call to `out/calls.log`.

```bash
cd research/probes/forgemax
export DENO_DIR=$PWD/../../impls/forgemax/deno-dir
R="deno run -A --no-config --node-modules-dir=none run-probes.ts"
$R default TOOLS P1 P1b P1c P2 P2b P2c P2d P3 P3b P4 P4b P4c P4d P5 P5b P6 P8 P8b P9 P9b P9c P10 P10b P11 P12a P12b P12c P12d P12e X1 X2 X2b X3 S1
../mem-lock.sh $R default P7
$R hardened P3 P3b P4 P4b P4c P4d P5 P5b P6 P8 P9 P9b P11 P12a P12b P12c P12d P12e X1 X2 X3
../mem-lock.sh $R hardened P7
$R inprocess P9 P9b X3     # diagnostic only: execution_mode = "in_process"
```

Configs: `forge.default.toml` (CLI defaults), `forge.hardened.toml` (sandbox, pool and stash sections of
`forge.toml.example.production`), `forge.inprocess.toml` (diagnostic). Probe code is wrapped in
`async () => { ... }` because `execute` requires that form. X1 and X2 write forged IPC frames with
`console.log` (see results). Output lands in `out/` (prefix `hardened-` or `inprocess-`); the results JSON
was written by hand from those files.
