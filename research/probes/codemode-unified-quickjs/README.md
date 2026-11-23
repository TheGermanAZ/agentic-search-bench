# codemode-unified-quickjs

The harness is shared and lives in `research/probes/codemode-unified-bun/` (see its README).

```bash
cd research/probes/codemode-unified-bun
node run-probes.mjs quickjs default && node run-probes.mjs quickjs hardened && python3 build-results.py
```

Output lands in `research/probes/codemode-unified-quickjs/out/`.
