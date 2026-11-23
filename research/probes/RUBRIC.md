# Ranking rubric and wave-2 additions

This file adds to `SPEC.md`; it does not change it. Read both.

## Two configurations per implementation

1. **Default.** What `SPEC.md` already asks for: the project's own defaults. This goes in `probes`.
2. **Hardened.** The strictest configuration the project itself documents or exposes as a public option (a timeout option, a memory limit, a network allowlist, a container backend). Rerun P3, P4, P5, P6, P7, P9 and P12 with it. Do not write wrappers the project does not ship: if the only way to get a limit is your own code, the hardened run does not have that limit. If the project exposes no stricter option, write `"hardened": null` and say why in `defaults`.

Add the hardened run to the results JSON as:

```json
"hardened": {
  "config": "exact option names and values, with file:line or docs URL",
  "probes": { "P6": { "outcome": "limited", "detail": "...", "evidence": "research/probes/<impl>/out/hardened-P6.txt", "display": "limited (30 s)" } }
}
```

## The `display` field

Every probe object (default and hardened) carries `display`: at most 40 characters, the honest short label for the matrix cell. Use the outcome word first, then the key fact in parentheses. Examples: `limited (30 s)`, `limited (128 MB)`, `blocked`, `works (example.com 200)`, `escaped (os.system)`, `parallel (205 ms)`, `serial (1,010 ms)`, `fresh`, `persists`, `host crash`, `no-limit-within-120s`, `truncated (8,000 + marker)`, `blocked-needs-credentials`. A limit that is really an operation counter or loop guard says so: `limited (op count)`. A whole-process crash is `host crash`, never `limited`.

## Gates for "best for untrusted model code"

An implementation is eligible only if, in its default or hardened configuration:

- **G1 isolation.** P4 files and P5 env are `blocked` or `not-defined`, and every P12 attempt is blocked. P3 network is blocked, or is off unless the host explicitly turns it on.
- **G2 time.** P6 is stopped by the implementation's own limit within 120 s.
- **G3 memory.** P7 is stopped for that execution only. The host process and other sessions survive.

## Ranking among eligible implementations

In order: P9 parallel tool calls; credentials kept on the host side of the bridge (source); P2 output capped with a visible marker; P10 error message and line survive; tool discovery that scales past 100 tools without putting every schema in the prompt (source); P11 median startup; maintenance (last commit date, license, releases); docs that match the code.

## Shared-machine rules (several workers run at once on one 36 GB Mac)

- **Memory probes take a lock.** Run every P7 and hardened P7 through `research/probes/mem-lock.sh <command...>`. It lets one memory probe run at a time across all workers. Keep the SPEC's kill at 4 GB host RSS or 120 s.
- **Kill only PIDs you started.** Never `pkill`, `killall`, or kill by process name. The user runs their own Executor daemon and other servers; leave them alone.
- **Ports.** Use only the port range you were given.
- **No global toolchain installs.** Do not `brew install` or install Go or Rust on the host. Use prebuilt release binaries, npm/uv/bun packages, or build inside Docker (`docker run --rm -v ...:/src golang:1 ...`). If an implementation runs only inside Docker, probe it there and say so in `how_run`.
- **Docker.** Name your containers with your impl name as the prefix and remove them when done. Do not touch other containers or images you did not create.
