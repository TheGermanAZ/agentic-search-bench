# mastra-codemode-isolated-vm

The harness is shared and lives in `research/probes/mastra-codemode-localsandbox/` (see its README).

```bash
cd research/probes/mastra-codemode-localsandbox
node run-probes.mjs isolated-vm default && node run-probes.mjs isolated-vm hardened && node run-probes.mjs isolated-vm hardened P6x && python3 build-results.py
```

Output lands in `research/probes/mastra-codemode-isolated-vm/out/`.
