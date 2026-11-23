# pi-codemode probe harness

Runs P1 to P12 from `research/probes/SPEC.md` (plus RUBRIC's hardened run) against `@earendil-works/pi-codemode`
1.6.0 through `new CodemodeSandbox({ tools, ... }).execute(code)`, the class Pi's coding agent uses.
Source pinned at earendil-works/pi `fb248c7fca2539318f18ceb6534258048cb579c1` (`research/impls/pi-codemode/repo`);
the probe imports the npm build installed in `research/impls/pi-codemode/npm`.

## Rerun

```bash
cd ~/p/agentic-search-bench/research/impls/pi-codemode/npm && npm install --ignore-scripts @earendil-works/pi-codemode@1.6.0
cd ~/p/agentic-search-bench/research/probes/pi-codemode && for c in default hardened agent; do pre=$([ $c = default ] || echo "$c-"); for p in P1 P2 P3 P4 P5 P6 P6b P8 P9 P10 P11 P12; do python3 -I watch.py out/${pre}$p.txt node probe.mjs $c $p; done; ../mem-lock.sh python3 -I watch.py out/${pre}P7.txt node probe.mjs $c P7; done; python3 -I build-results.py
```

`probe.mjs <config> <probe>` prints one JSON result. Configs: `default` (package defaults), `hardened`
(`timeoutMs: 30000`, `memoryLimitBytes: 32 MiB`), `agent` (what Pi's coding agent passes: `timeoutMs: Infinity`,
256 MiB). `watch.py` runs one probe process, samples the RSS of its process tree every 50 ms, and kills it at
4 GB or 120 s. `build-results.py` writes `research/probes/results/pi-codemode.json`; its details were written by hand
from `out/`, so recheck them after a rerun. `out/P6-uncapped-300s.txt` is a plain `node probe.mjs default P6` run
without the 120 s kill, to confirm the 300 s default.
