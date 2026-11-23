# lootbox probe harness

Runs SPEC P1 to P12 plus extras against Lootbox at commit `587a5a1b2694d0d00168665d8f1a536bc54e0f1a`,
cloned to `research/impls/lootbox/repo`. The harness starts `lootbox server` from source in `work/`
(port 41310, tools in `work/.lootbox/tools/host.ts`, data in `work/data`) and sends each probe as the
WebSocket message `lootbox exec` sends.

```bash
cd research/impls/lootbox/repo && DENO_DIR=../deno-dir deno cache --no-lock src/lootbox-cli.ts   # once
cd research/probes/lootbox
DENO_DIR=../../impls/lootbox/deno-dir deno run -A run-probes.ts P1 P2 P3 P4 P4b P4c P5 P5b P6 P8 P8b P9 P10 P10b P11 P12a P12b P12c P12d P12e P12f P12g X1 X2 X3
../mem-lock.sh deno run -A run-probes.ts P7
```

There is no hardened run: Lootbox exposes no timeout, memory or network option. `--no-lock` is needed
because `deno.lock` pins npmmirror tarball URLs. Host calls are counted in `work/calls.log` by the tool
itself, since tools run in their own worker process. Output lands in `out/`; the results JSON was
written by hand from those files.
