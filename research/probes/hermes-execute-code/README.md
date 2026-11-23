# hermes-execute-code probe harness

SPEC P1 to P12 plus the RUBRIC hardened run against Hermes Agent's `execute_code` (tag v0.23.3, source checkout). Each execution calls `tools.code_execution_tool.execute_code(...)`, the function the registered tool handler dispatches to. No LLM.

```bash
cd research/impls/hermes-execute-code && git clone --depth 1 --branch v0.23.3 https://github.com/NousResearch/hermes-agent src && (cd src && UV_PROJECT_ENVIRONMENT=$PWD/../.venv uv sync --frozen --python 3.14) && docker pull nousresearch/hermes-sandbox:desktop
research/probes/hermes-execute-code/run_all.sh
```

- `HERMES_HOME` is set to `research/impls/hermes-execute-code/home` (default: local backend) or `home-hardened` (Docker backend, `docker_network: false`, `container_memory: 512`, `code_execution.mode: strict`, `timeout: 10`). Both `config.yaml` files turn shared-metrics telemetry off. Nothing under `~/.hermes` is read.
- `lookup` cannot be exposed through any Hermes option, so `adapter.py` registers it with `registry.register` and adds it to `SANDBOX_ALLOWED_TOOLS` and `_TOOL_STUBS` in-process. `P1t` and `P9t` use the built-in `terminal` tool with no patch.
- Hermes names its containers `hermes-<hex>`; the hardened config labels them `asb-impl=hermes-execute-code`, and `docker_cleanup.sh` records their state (OOMKilled, limits) and removes only those.
- Extras: `P5scrub` (a `PATH`-prefixed credential and the parent's environment through `ps -E`), `P9threads`, `Pcap`, `Pwrite`, `Ptoolcap` (55 calls vs the 50 cap), `P7next`. Side check `p6_default_check.py`: the default 300 s timeout, outside the 120 s harness stop.

`probe_core.py` is the shared wave-2 runner (copied from `fastmcp-codemode`). Evidence: `out/<tag>.txt`.
