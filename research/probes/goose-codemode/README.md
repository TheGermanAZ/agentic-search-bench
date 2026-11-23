# goose Code Mode probes

The harness compiles goose's `javascript.rs` from the pinned clone verbatim and calls `javascript::execute`, the function goose's `execute_javascript` tool calls. Each probe runs in its own process so the driver can watch wall time and RSS.

Pinned: aaif-goose/goose `36b29113aff691e1a46a21a5c25900824caf9949`, cloned to `research/impls/goose-codemode/src`. The Rust toolchain is installed inside `research/impls/goose-codemode/toolchain`.

```sh
export RUSTUP_HOME=$PWD/research/impls/goose-codemode/toolchain/rustup CARGO_HOME=$PWD/research/impls/goose-codemode/toolchain/cargo CARGO_TARGET_DIR=$PWD/research/impls/goose-codemode/target
(cd research/probes/goose-codemode/harness && $CARGO_HOME/bin/cargo build --release) && python3 -I research/probes/goose-codemode/run_probes.py   # or: ... run_probes.py P1 P9
```

Results land in `out/P*.txt`, with raw JSON in `out/raw/`. `P2b`, `P6b`, `P7b` and `P7c` are variants: the spec's `repeat()` calls trip Boa's loop limit before the probe's real question is asked.
