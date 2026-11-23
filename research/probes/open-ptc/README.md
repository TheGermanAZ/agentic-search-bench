# open-ptc probe harness

Runs SPEC P1 to P12 plus two extra probes against Open-PTC at commit
`2f2ef0ce4087d338a2cd1646c8ef18cc3f57b1de`, cloned to `research/impls/open-ptc/repo`.
The harness starts the project's own server (`src/server.ts --ws`) on ports 41302 (RPC) and 41303 (WS),
registers `lookup` as a WebSocket local tool, and sends each probe as `execute_code`.

```bash
cd research/impls/open-ptc/repo && DENO_DIR=../deno-dir deno cache --no-lock src/server.ts   # once
cd research/probes/open-ptc
deno run -A run-probes.ts default P1 P2 P3 P3b P4 P4b P4c P5 P5b P5c P6 P8 P9 P10 P10b P11 P12a P12b P12c P12d P12e X1 X2
../mem-lock.sh deno run -A run-probes.ts default P7
deno run -A run-probes.ts hardened P3 P3b P4 P4b P4c P5 P5b P5c P6 P9 P12a P12b P12c P12d P12e
../mem-lock.sh deno run -A run-probes.ts hardened P7
```

`--no-lock` is needed because `deno.lock` no longer matches the unpinned esm.sh import (see results surprises).
Hardened mode sets `CODE_EXECUTION_TIMEOUT_MS=5000`. P7 samples the server's process-tree RSS every 100 ms
and kills the sandbox child at 4 GB. X1 shows one WebSocket connection's sandbox calling another
connection's tool; X2 shows sandbox code talking to the RPC server directly. Output lands in `out/`;
the results JSON was written by hand from those files.
