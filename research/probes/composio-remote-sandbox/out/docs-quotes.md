# Composio sandbox docs, verbatim quotes (fetched 2026-11-22)

Source: https://docs.composio.dev/docs/sandbox/remote (page source: https://github.com/ComposioHQ/composio/blob/next/docs/content/docs/sandbox/remote.mdx)

- "The **sandbox** is a persistent Python environment where your agent writes and executes code. It has programmatic access to all Composio tools, plus helper functions for calling LLMs, uploading files, and making API requests. State persists across calls within a session. Your agent runs code in it through the `COMPOSIO_REMOTE_WORKBENCH` meta tool, and shell commands through `COMPOSIO_REMOTE_BASH_TOOL`."
- "Standard sessions enable the sandbox by default, and you can disable it."
- "Your agent starts with `SEARCH_TOOLS` to find the right tools, then uses `MULTI_EXECUTE` for straightforward calls. When the task involves bulk operations, data transformations, or multi-step logic, the agent reaches for `COMPOSIO_REMOTE_WORKBENCH` instead."
- Helpers: "`run_composio_tool` | Execute any Composio tool", "`invoke_llm` | Call an LLM", "`upload_local_file`", "`proxy_execute` | Make direct API calls to connected services when no pre-built tool exists", "`web_search`", "`smart_file_extract`".
- "The sandbox ships with common packages pre-installed: `pandas`, `numpy`, `matplotlib`, `Pillow`, `PyTorch`, and `reportlab`. ... If the agent uses a package that isn't already installed, the sandbox installs it automatically."
- "The sandbox corrects common mistakes in the code your agent generates. For example, if a script accesses `result["apiKey"]` but the actual field name is `api_key`, the sandbox resolves the mismatch instead of failing."
- "The sandbox runs as a persistent Jupyter notebook. Variables, imports, files, and in-memory state from one call are available in the next."
- "Sandboxes default to `standard` (1 vCPU, 1 GB RAM)." Tiers: standard 1 vCPU/1 GB, medium 2/2 GB, large 4/4 GB, xlarge 8/8 GB.
- "**Pricing:** Sandboxes are not billed today."
- "The sandbox has a persistent file mount at `/mnt/files/`."

Source: https://docs.composio.dev/docs/sandbox/local (Experimental)

- "A **local sandbox** runs your agent's code in your own infrastructure instead of Composio's hosted remote sandbox"
- "A local sandbox session is a session created with the remote sandbox turned off. Set `workbench.enable: false`, then pass the session to `experimental_createLocalWorkbenchSession`" with `const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });`
- "`helperSource` | A Python helper, as source you write into your sandbox" and "`env` | The environment variables that helper needs to reach Composio from inside your box."
- "Every `run_composio_tool` call routes back through the Tool Router under the session's connections"
- "The helper reaches Composio with your project `COMPOSIO_API_KEY`, injected into the sandbox through `env`. Any code or output in the sandbox can read it, and that key acts across every connection on the project."
- "The sandbox is your security boundary."
