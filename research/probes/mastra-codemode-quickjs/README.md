# mastra-codemode-quickjs

The harness is shared and lives in `research/probes/mastra-codemode-localsandbox/` (see its README).

```bash
cd research/probes/mastra-codemode-localsandbox
node run-probes.mjs quickjs default && node run-probes.mjs quickjs hardened && node run-probes.mjs quickjs hardened P6x && python3 build-results.py
```

Output lands in `research/probes/mastra-codemode-quickjs/out/`.
