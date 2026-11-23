"""Writes research/probes/results/datalayer-codemode-hosted.json: one blocked-needs-credentials row for
the Datalayer agent-codemode sandbox variants that run on someone else's account. Nothing was run."""
import json
from pathlib import Path

SRC = "https://github.com/datalayer/agent-codemode/blob/566e324a42e86074d29fd5e6bb5da2f282d459ea"
probes = {
    f"P{i}": {
        "outcome": "blocked-needs-credentials",
        "detail": "Not run: every hosted variant needs an account or API token (Modal, Datalayer, Google Colab, Kaggle). This worker was told not to log in or look for credentials.",
        "evidence": "research/probes/datalayer-codemode-hosted/README.md",
        "display": "blocked-needs-credentials",
    }
    for i in range(1, 13)
}
result = {
    "impl": "datalayer-codemode-hosted",
    "name": "Datalayer Agent Codemode, hosted sandbox variants (modal, datalayer, google-colab, kaggle)",
    "source": "https://github.com/datalayer/agent-codemode (sandboxes from PyPI code-sandboxes)",
    "pinned": "agent-codemode 566e324a42e86074d29fd5e6bb5da2f282d459ea (1.1.1), code-sandboxes 1.12.4",
    "language": "Python",
    "engine": "Remote Jupyter-style kernels on the provider (Modal containers, Datalayer runtimes, Colab or Kaggle kernels). Not observed.",
    "how_run": "Not run. Would be CodeModeExecutor(registry, CodeModeConfig(sandbox_variant='modal' | 'datalayer' | 'google-colab' | 'kaggle')).execute(code); each needs provider credentials.",
    "probes": probes,
    "defaults": {
        "time": "SandboxConfig.timeout is 300 s for 'datalayer' and 30 s for every other variant when CodeModeExecutor builds the client (executor.py:248-250); not observed.",
        "memory": "Not observed.",
        "output": "Not observed.",
        "tool_calls": "CodeModeConfig.max_tool_calls defaults to None (types.py:233)."
    },
    "hardened": None,
    "source_notes": [
        {
            "topic": "Credentials",
            "finding": "For every variant CodeModeExecutor.setup() copies the whole host environment into the sandbox config (env_vars = dict(os.environ)). On a hosted variant that would ship the host's environment, including any API keys, to the provider's kernel. Inferred from the code; not run.",
            "evidence": f"{SRC}/agent_codemode/composition/executor.py#L239-L252"
        },
        {
            "topic": "Bridge",
            "finding": "Remote variants call tools either through an HTTP proxy (mcp_proxy_url, served by the separate agent-runtimes project) or by constructing MCP clients inside the kernel from the host's server configs, including their env dicts. Without mcp_proxy_url the kernel needs agent_codemode installed and must be able to start the MCP servers itself.",
            "evidence": f"{SRC}/agent_codemode/composition/executor.py#L394-L599"
        }
    ],
    "surprises": [
        "The README lists colab, kaggle, modal and datalayer as sandbox_variant values; the docstring in types.py spells two of them 'google-colab' and 'jupyter-server'."
    ]
}
dest = Path(__file__).resolve().parent.parent / "results" / "datalayer-codemode-hosted.json"
dest.write_text(json.dumps(result, indent=2) + "\n")
print(f"wrote {dest}")
