P = "research/probes/composio-remote-sandbox"
Q = f"{P}/out/docs-quotes.md"
R = "https://docs.composio.dev/docs/sandbox/remote"
L = "https://docs.composio.dev/docs/sandbox/local"

IMPL = "composio-remote-sandbox"
NAME = "Composio Remote Sandbox (COMPOSIO_REMOTE_WORKBENCH)"
SOURCE = f"{R} ; {L} (docs source: https://github.com/ComposioHQ/composio/blob/next/docs/content/docs/sandbox/remote.mdx)"
PINNED = "docs fetched 2026-11-22 (hosted service; no version)"
LANGUAGE = "Python"
ENGINE = "Hosted \"persistent Jupyter notebook\" per session on Composio's infrastructure (standard tier 1 vCPU, 1 GB RAM); engine and isolation technology not stated."
HOW_RUN = ("Not run: the remote sandbox is reached through a Composio session (COMPOSIO_API_KEY), and the experimental local sandbox also needs a session and "
           "injects COMPOSIO_API_KEY into the sandbox. No credentials were used.")


def bc(extra="", display="blocked-needs-credentials"):
    return {"outcome": "blocked-needs-credentials", "detail": "Hosted service behind a Composio API key; not run." + (" Docs: " + extra if extra else ""), "display": display, "evidence": Q}


OVERRIDES = {f"P{i}": bc() for i in range(1, 13)}
OVERRIDES["P1"] = bc("tools are called with run_composio_tool(\"TOOL_SLUG\", {...}) from inside the sandbox.")
OVERRIDES["P3"] = bc("helpers include proxy_execute and web_search; the docs do not state whether arbitrary outbound network is allowed.")
OVERRIDES["P7"] = bc("standard tier is 1 vCPU / 1 GB RAM; larger tiers up to 8 GB.")
OVERRIDES["P8"] = bc("\"Variables, imports, files, and in-memory state from one call are available in the next.\"")

HARDENED_CONFIG = None

DEFAULTS = {
    "time": "Not documented.",
    "memory": "1 GB RAM on the default standard tier; 2/4/8 GB on medium/large/xlarge (docs).",
    "output": "Not documented.",
    "tool_calls": "Not documented.",
    "hardened": "null: not run; the docs expose compute tiers, not stricter isolation options.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "Helper functions pre-initialized in the notebook: run_composio_tool (any Composio tool by slug), invoke_llm, upload_local_file, proxy_execute, web_search, smart_file_extract.", "evidence": f"{R}#built-in-helpers ; {Q}"},
    {"topic": "Discovery", "finding": "Meta tools: SEARCH_TOOLS finds tools, MULTI_EXECUTE runs simple calls, COMPOSIO_REMOTE_WORKBENCH runs code for bulk or multi-step work.", "evidence": f"{R}#where-it-fits ; {Q}"},
    {"topic": "Bridge", "finding": "run_composio_tool calls back to Composio's Tool Router, which holds the user's connected-account auth. In the local variant every call routes back through the Tool Router.", "evidence": f"{L}#the-helper-contract ; {Q}"},
    {"topic": "Isolation boundary", "finding": "Not stated for the remote sandbox. For the local sandbox the docs say \"The sandbox is your security boundary\" and that the project COMPOSIO_API_KEY is injected into the sandbox env, readable by any code and acting across every connection on the project.", "evidence": f"{L}#security-the-sandbox-is-your-boundary ; {Q}"},
    {"topic": "Output channel", "finding": "Not documented beyond notebook execution results and files on the /mnt/files mount.", "evidence": f"{R}#files-and-mounts"},
    {"topic": "Limits", "finding": "Compute tiers only (1 vCPU / 1 GB default). No time or output limits documented.", "evidence": f"{R}#compute-tier"},
    {"topic": "State", "finding": "Persistent Jupyter notebook per session; /mnt/files survives sandbox restarts.", "evidence": f"{R}#persistent-state"},
    {"topic": "Errors", "finding": "The sandbox \"corrects common mistakes in the code your agent generates\", for example mapping result[\"apiKey\"] to api_key instead of failing.", "evidence": f"{R}#error-correction ; {Q}"},
    {"topic": "Anything else", "finding": "Packages not preinstalled are installed automatically on use. invoke_llm inside the sandbox is the only Composio-side LLM usage. Sandboxes are not billed today.", "evidence": f"{R}#libraries ; {Q}"},
]

SURPRISES = [
    "The sandbox silently rewrites failing code (\"resolves the mismatch instead of failing\"), so the model can get results from code that would have errored.",
    "The local sandbox puts the project-wide COMPOSIO_API_KEY inside the sandbox environment, where any model-written code can read it.",
    "Missing packages are installed automatically, which implies outbound package-index access from the sandbox (inferred, not tested).",
]
