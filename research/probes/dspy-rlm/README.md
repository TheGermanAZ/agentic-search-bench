# dspy-rlm probe harness

SPEC P1 to P12 against `dspy.RLM(..., tools=[lookup])` with the default `PythonInterpreter` (Pyodide 0.29.4 on Deno). The LLM is `dspy.utils.DummyLM` with a scripted `{plan, code}` per iteration; each probe execution is one real `rlm(question=...)` forward, and the harness records the REPL message the next LM request carries (what the model sees). No API key. Hardened is `null` (no stricter option exists; see `defaults.hardened` in the results file).

```bash
cd research/impls/dspy-rlm && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "dspy==3.5.0"   # plus Deno 2.x on PATH
research/probes/dspy-rlm/run_all.sh
```

`probe_core.py` is the shared wave-2 runner (copied from `fastmcp-codemode`); `adapter.py` is the DSPy part and also defines the extras: `P2both` (print plus trailing expression), `Pcap` (30,000-char print vs `max_output_chars`), `P3try` and `P12jsTry` (network and `js.Deno.*` attempts wrapped in try/except, so the exception text is visible instead of the sandbox dying), `P12js` (the same uncaught), `P8within` (state across two iterations of one forward), `P7next` (next iteration after MemoryError). `p11_breakdown.py` separates per-forward start-up from per-iteration cost. Evidence: `out/<tag>.txt`.
