# Pydantic Monty probes

Pins: `pydantic-monty` 1.6.0 from PyPI (client 1.6.0, runtime 1.6.0). Source is the `pydantic/monty` tag `v1.6.0` at commit `3f89dcbf82071896efb5e3ded507db4191e8d829`. The repo `main` is `5f4a3dfc` (v1.7.0-beta.1), which was not run. The Pydantic AI integration is `pydantic-ai-harness` 0.71.0 (`CodeMode`), read from `../../impls/pydantic-monty/.venv-pai`.

Rerun (about 2.5 minutes, P6 takes 120 s):

    cd research/probes/pydantic-monty
    ../../impls/pydantic-monty/.venv/bin/python run_probes.py          # P1..P12
    ../../impls/pydantic-monty/.venv/bin/python run_probes.py P4 P12   # some probes
    ../../impls/pydantic-monty/.venv/bin/python claims_check.py        # article claims: architecture, API, latency, limits
    ../../impls/pydantic-monty/.venv/bin/python snapshot_check.py      # snapshot dump and restore in a new pool

Outputs: `out/<probe>.txt` (evidence), `out/<probe>.json`, `out/summary.json`, `out/claims.txt`, `out/snapshot.txt`.

Setup, if the venv is missing:

    cd research/impls/pydantic-monty
    git clone --depth 1 https://github.com/pydantic/monty src && git -C src fetch --depth 1 origin tag v1.6.0 && git -C src checkout v1.6.0
    uv venv .venv && uv pip install --python .venv/bin/python pydantic-monty==1.6.0

Harness rules: each probe runs in a child process. The parent kills the process group at 120 s for P6 and P7, and kills P7 at 4 GiB summed RSS of the process tree (child plus the `monty` worker).

Repeats and reruns: `p7_repeat.py 5` writes `out/P7_repeats.txt` (P7 is non-deterministic under memory pressure). `summary.json` comes from the full run before the P7 repeats and the asserted P11 rerun. The per-probe `.txt` files are the latest runs.
Repeat helper for P7 (writes out/P7_repeats.txt):

    ../../impls/pydantic-monty/.venv/bin/python p7_repeat.py 5

Hardened run (RUBRIC): `checkout(limits={'max_memory': 10_000_000, 'max_feed_duration_secs': 1.0, 'max_recursion_depth': 100})`, the example in `docs/resource-limits.md`. Writes `out/hardened-<P>.*`:

    ../../impls/pydantic-monty/.venv/bin/python hardened.py P3 P4 P5 P6 P9 P12
    ../mem-lock.sh ../../impls/pydantic-monty/.venv/bin/python hardened.py P7
