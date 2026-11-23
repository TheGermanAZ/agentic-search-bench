# Codex probes

Two harnesses, both with no model call and `CODEX_HOME` pointed at the empty `research/impls/codex-sandbox/codex-home`.

1. `run_probes.py` runs the SPEC probes as shell and python3 commands under `codex sandbox` (macOS Seatbelt), in read-only and workspace-write modes. Output goes to `out/P*.txt`.
2. `run_codemode_probes.py` drives the shipped `codex-code-mode-host` (V8) over its framed-JSON stdio protocol with a `lookup` tool. Output goes to `out/codemode/`, including `codex-codemode.results.json`.

Pinned: codex-cli 0.169.0 from bun's `@openai/codex-darwin-arm64`; source tag `rust-v0.169.0` cloned to `research/impls/codex-sandbox/src`. Override binaries with `CODEX_BIN` and `CODEX_CODE_MODE_HOST`.

```sh
python3 -I research/probes/codex-sandbox/run_probes.py            # P6 waits the full 120 s
python3 -I research/probes/codex-sandbox/run_codemode_probes.py   # or name probes: ... P1 P9
```
