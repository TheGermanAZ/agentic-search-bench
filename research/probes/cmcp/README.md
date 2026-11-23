# cmcp probe harness

Runs SPEC P1-P12 against cmcp's `execute` (and `search`) tools over MCP stdio, no LLM. cmcp has no releases and Rust is
not installed on the host, so it is built and run in Docker (linux/arm64). cmcp exposes no limit options, so there is no
hardened run.

```bash
cd ~/p/agentic-search-bench/research/impls/cmcp && docker run --rm --name cmcp-build -v "$PWD/repo":/src -v "$PWD/cargo-home":/usr/local/cargo/registry -w /src rust:1-bookworm cargo build --release --locked
cd ~/p/agentic-search-bench/research/probes/cmcp && node run-probes.mjs --only setup,P1,P2,P3,P4,P5,P8,P10,P11,P12 && node run-probes.mjs --only P9 && node run-probes.mjs --only P2utf8 && node run-probes.mjs --only P6 && ../mem-lock.sh sh -c 'node run-probes.mjs --only P7; node run-probes.mjs --only P7hog' && python3 build-results.py
```

- `state/config.toml` registers `lookup-server.mjs` twice (`lookup`, `lookup2`); it was written by
  `cmcp --config /work/state/config.toml add --transport stdio lookup -- node /work/lookup-server.mjs /work/state/calls.log` inside the container.
- Each run starts a container named `cmcp-probe-<pid>-<n>` from `node:24-bookworm-slim` with the binary mounted read-only and
  removes it at the end. P7 reads the container's cgroup `memory.current` and would kill at 4 GB.
- P9 must run on a fresh proxy: state persists, and P8 poisons `Array.prototype.map` for later probes in the same process.
- `build-results.py` holds hand-written outcomes; recheck them against `out/` after a rerun. Timings swing with machine load.
