# llamaindex-codeact probe harness

SPEC P1 to P12 through `CodeActAgent(code_execute_fn=code_executor.execute, ...)` exactly as the docs notebook builds it (SimpleCodeExecutor copied verbatim from cell 5), driven with a scripted `CustomLLM`. No hardened run (see the results file).

```bash
cd research/impls/llamaindex-codeact && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python llama-index-core==0.14.26 numpy
research/probes/llamaindex-codeact/run_all.sh
```

`research/impls/llamaindex-codeact/code_act_agent.ipynb` is the notebook at the commit in `notebook_sha.txt`. Evidence: `out/<tag>.txt`.
