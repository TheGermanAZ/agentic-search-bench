# codemode-unified-deno

The harness is shared and lives in `research/probes/codemode-unified-bun/` (see its README).

```bash
cd research/probes/codemode-unified-bun
node run-probes.mjs deno default && node run-probes.mjs deno hardened && python3 build-results.py
```

Output lands in `research/probes/codemode-unified-deno/out/`.
