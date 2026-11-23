# goose Code Mode hardened run

Same verbatim `javascript.rs` as `harness/`, but the timeout comes from `GOOSE_DEFAULT_EXTENSION_TIMEOUT`
(the only public knob), set to 10 seconds by the driver.

```sh
export RUSTUP_HOME=$PWD/research/impls/goose-codemode/toolchain/rustup CARGO_HOME=$PWD/research/impls/goose-codemode/toolchain/cargo CARGO_TARGET_DIR=$PWD/research/impls/goose-codemode/target
(cd research/probes/goose-codemode/hardened-harness && $CARGO_HOME/bin/cargo build --release --offline)
python3 -I research/probes/goose-codemode/hardened-run_probes.py P1 P3 P4 P5 P6 P9 P12 P6b-thread
research/probes/mem-lock.sh python3 -I research/probes/goose-codemode/hardened-run_probes.py P7 P7b
```

`P7` is the SPEC code. `P7b` builds the string by doubling so Boa's loop guard does not stop it first.
`P6b-thread` checks whether the deadline stops the worker thread (it does not; stuck threads keep goose's 4 worker slots).
