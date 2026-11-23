# vercel-just-bash probe harness

Runs the code-mode sandbox probes (P1 to P12, plus variants) against just-bash 3.6.1 at source commit ec5ab766551d479f2782b078b373d49ddc78bd26. The harness imports `Bash` from the package root, the same import bash-tool uses.

Setup (already done): `cd ~/p/agentic-search-bench/research/impls/vercel-just-bash/install && npm install --ignore-scripts just-bash@3.6.1`, then `ln -s ~/p/agentic-search-bench/research/impls/vercel-just-bash/install/node_modules ~/p/agentic-search-bench/research/probes/vercel-just-bash/node_modules`.

Rerun everything (about 2 minutes, writes `out/` and the results JSON):

```sh
cd ~/p/agentic-search-bench/research/probes/vercel-just-bash && node run.mjs && node build-results.mjs
```

Rerun the explain-the-number checks (repeats, defense-in-depth ablation, CPU profile):

```sh
cd ~/p/agentic-search-bench/research/probes/vercel-just-bash && node repeat.mjs P6 5 && node repeat.mjs P7 5 && node repeat.mjs P11 5 && node ablate-defense.mjs > out/ablate-defense.json && node --cpu-prof --cpu-prof-dir=out/profile profile-p11.mjs > out/profile/profile-run.json && node top-self-time.mjs "$(ls -t out/profile/*.cpuprofile | head -1)" 12 > out/profile/top-self-time.txt
```

Files:

- `probe.mjs` runs one probe in a fresh sandbox and prints JSON. `run.mjs` runs each probe in its own process, enforces the 120 s and 4 GB stop rules, and writes `out/<probe>.txt`, `out/<probe>.json`, and `out/summary.json`.
- `build-results.mjs` writes `research/probes/results/vercel-just-bash.json` from those outputs and the source notes it holds.
- The stop rules, the host `lookup` tool (200 ms sleep, counted), and `PROBE_SECRET=s3cr3t` are set in `probe.mjs` and `run.mjs`.
- The sandbox never receives network access except the P3 allowlist check against `https://example.com`. The npm install is the only other network use.
- The cloned source under `research/impls/vercel-just-bash/repo` is read only. Nothing here builds or writes into it.
