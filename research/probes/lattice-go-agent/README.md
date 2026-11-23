# lattice-go-agent probe harness

SPEC probes, written in Expr, against go-utcp v1.12.3 `codemode.CodeModeUTCP.Execute` (the runtime Protocol-Lattice/go-agent ebf73f2 uses), no model. Go is not on the host, so the harness builds and runs in Docker (golang:1, containers named lattice-go-agent-probe-*, module cache in the volume lattice-go-agent-gocache).

```bash
cd research/probes/lattice-go-agent && ./run_all.sh && python3 -I collect.py
```

Raw results are JSON lines in out/*.jsonl. Results are mapped to SPEC outcomes by hand in meta.py because Expr cannot express several SPEC forms (no loops, print or throw).
