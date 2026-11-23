# Claude Code Bash sandbox probe (P3 to P5)

Runs `claude -p --model haiku` with only Bash, no user/project/local settings (`--setting-sources ""`), and one settings file passed with `--settings`. Haiku is told to run fixed commands; the evidence is the raw `tool_result` in the stream-json transcript, not the model's reply.

    ./run.sh sandbox-on-allow-curl.json out/run4-sandbox-on-allow-curl
    python3 -I extract.py out/run4-sandbox-on-allow-curl.jsonl

Settings files:
- `sandbox-on.json`: sandbox on, `failIfUnavailable`, `autoAllowBashIfSandboxed`, no unsandboxed retry, empty `allowedDomains`, `strictAllowlist`.
- `sandbox-on-allow-curl.json`: same plus `permissions.allow: ["Bash(curl *)"]` so curl reaches the sandbox instead of being refused by the permission layer.
- `sandbox-deny-env.json`: same as `sandbox-on.json` plus `credentials.envVars` deny for `PROBE_SECRET`.

`run.sh` exports `PROBE_SECRET=s3cr3t`. Runs on 2026-11-22 used Claude Code 2.1.325. Each run cost about $0.03 (`total_cost_usd` in the transcript).

Results:
- run1 (compound `cmd; echo` commands): refused by the permission layer, see `out/run1-compound-commands-rejected.jsonl`.
- run2 (`sandbox-on.json`): `HTTPS_PROXY` points at the local sandbox proxy, curl refused by permissions, `/etc/hosts` readable, `PROBE_SECRET` = `s3cr3t`.
- run3 (`sandbox-deny-env.json`): `printenv PROBE_SECRET` exits 1.
- run4 (`sandbox-on-allow-curl.json`): curl via proxy gets `CONNECT tunnel failed, response 403` and a `deny network-outbound example.com:443` violation; `--noproxy '*'` gets `Could not resolve host`.

The `.summary.txt` files redact the per-session proxy credentials; the raw `.jsonl` keeps them (they were valid only for that session).
