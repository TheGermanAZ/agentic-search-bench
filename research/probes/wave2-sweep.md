# Code-mode sweep, wave 2

Sweep date: 2026-11-22.

Scope: code-mode, programmatic-tool-calling and CodeAct-style features not already listed in `missed-implementations.md`, `probes/results/`, `research/impls/` or `code-mode-survey.md`. OpenCode and Claude Code are excluded because another worker covers them. The sweep covered coding agents, agent frameworks, MCP gateways and proxies, and 2026 releases.

Method: Firecrawl and web search found the leads. Every row below was then read from its primary source this session: the repo file through `raw.githubusercontent.com`, the official docs page, or the vendor blog or changelog. Quotes are copied from those files. Where the source hard-wraps a sentence across lines, the line breaks are joined and nothing else changes. Versions and dates come from the PyPI JSON API, the npm registry and the GitHub releases API on 2026-11-22. For the "checked, no code mode" list I fetched each repo's full default-branch file tree and grepped paths for `code_?mode|codemode|code-mode|programmatic|codeact|_ptc|execute_code`. This is weak negative evidence: agentgateway has a documented code mode and still scored zero, because its files use other names.

"True code mode" means model-written code calls host tools from inside an execution environment, and only what the code prints or returns reaches the model. "Runs locally without an account" means no vendor account beyond a model API key.

## Table

| Name | Primary URL | Engine | True code mode? | Quoted primary-source sentence | Runs locally without an account? | Last release or commit date |
|---|---|---|---|---|---|---|
| Pydantic AI Harness `CodeMode` | https://pydantic.dev/docs/ai/harness/code-mode/ | Monty (Rust Python-subset interpreter), in process or on a remote Monty server | yes: tools become functions inside one `run_code` tool | "Calls from that code are dispatched through Pydantic AI to the host tools." | yes. `pip install "pydantic-ai-harness[codemode]"` (0.71.0) | 0.71.0 on PyPI, 2026-11-19 |
| Pydantic AI Harness `IPythonCodeMode` | https://pydantic.dev/docs/ai/harness/code-mode/ | Persistent IPython kernel, full CPython, no sandbox | yes, but unsandboxed: same bridge, runs with the user's permissions | "IPython Code Mode offers the same run_code tool backed by a persistent IPython kernel instead of Monty." | yes. Same package. The extra that pulls in the IPython dependencies was not checked | 0.71.0 on PyPI, 2026-11-19 |
| DSPy `RLM` with `tools=` | https://raw.githubusercontent.com/stanfordnlp/dspy/main/dspy/predict/rlm.py | Pyodide on Deno (local WASM) by default; pluggable `interpreter_factory` | yes: user tools are callable from the REPL next to `llm_query` | "tools: List of tool functions or dspy.Tool objects callable from interpreter code." | yes. `pip install dspy==3.5.0` plus Deno 2.x (the interpreter checks for 2.0 up to but not including 3.0) | 3.5.0 on PyPI, 2026-11-10 |
| Agno `CodeMode` toolkit | https://github.com/agno-agi/agno/blob/main/libs/agno/agno/tools/code/code_mode.py | Persistent IPython kernel per session; the docstring says it is not a sandbox | yes, but unsandboxed: injected tools become awaitable functions in the kernel | "Tool calls are await expressions, so their return values can be bound to variables and composed into program logic like any other call." | yes. `pip install "agno[code]"` (3.2.1). The file exists at tag v3.2.1 | v3.2.1, 2026-11-17 |
| langchain-quickjs `CodeInterpreterMiddleware` (deepagents) | https://github.com/langchain-ai/deepagents/blob/main/libs/partners/quickjs/README.md | QuickJS through `quickjs-rs` (PyO3 and rquickjs), persistent REPL | yes: tools exposed as `tools.<camelCaseName>()` | "PTC is the reason to use this middleware over a plain code-interpreter tool." | yes. `pip install langchain-quickjs==0.4.0` with `deepagents` | 0.4.0 on PyPI, 2026-11-19 |
| Strands harness `programmatic_tool_caller` | https://github.com/strands-agents/sdk-python/blob/main/site/src/content/docs/user-guide/harness/tools/programmatic-tool-calling.mdx | Monty in a separate worker process | yes. On by default in the Strands harness | "Only text the code sends to `print` returns to the model; a tool's return value stays in the code's local scope unless the code prints it." | yes. PyPI `strands-harness` 0.4.0, npm `@strands-agents/harness` 0.5.0. Names come from `pyproject.toml` and `package.json`; I did not read an install doc | strands-harness 0.4.0, 2026-11-12; @strands-agents/harness 0.5.0, 2026-11-19 |
| Qwen Code `codeModeOnly` | https://github.com/QwenLM/qwen-code/blob/main/docs/design/code-mode-only.md | QuickJS compiled to WASM (`quickjs-emscripten`) in a child process, with a fresh runtime per call | yes: one `exec` tool, with `tools.<name>(args)` inside. Opt-in, off by default | "`exec` code can call ordinary tools through `tools.<name>(args)` without bypassing Qwen Code's validation, permissions, approvals, hooks, telemetry, cancellation, concurrency, or output budgets." | yes. `npm install -g @qwen-code/qwen-code` (0.28.4), then set `tools.codeModeOnly: true`. The source is present at tag v0.28.4 | v0.28.4, 2026-11-22 |
| OpenClaw Code Mode | https://github.com/openclaw/openclaw/blob/main/docs/tools/code-mode.md | Node `node:vm` in a worker thread by default (not a security boundary), or QuickJS-WASI through a bundled plugin | yes: only `exec` and `wait` are shown, and code searches and calls the hidden catalog | "The model writes a small JavaScript program that searches, describes, and calls the hidden tool catalog." | yes. npm `openclaw` 2026.11.6. The name comes from `package.json`; I did not read an install doc. Docs are present at tag v2026.11.6 | 2026.11.6 on npm, 2026-11-19 |
| Hermes Agent `execute_code` (Nous Research) | https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py | CPython session kernel in a child process, with tool calls over RPC on a Unix socket. Isolation is an environment scrub, not a sandbox | yes | "The LLM writes a Python script that calls Hermes tools via RPC, collapsing multi-step tool chains into one inference turn; only the script's stdout returns to the LLM." | yes. `curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash` (from the README) | v0.23.3, 2026-11-20 |
| hermes-codemode (community Hermes plugin) | https://github.com/junbo-hh/hermes-codemode | QuickJS hosted in a short-lived Python child process | yes: JS calls MCP tools through `ctx.dispatch_tool`; BM25 `searchTools()` | "`codemode` lets the model write a short JavaScript snippet that calls your Hermes tools in a loop, filters the results and returns only the answer." | yes, as a Hermes plugin (catalog lists v0.2.0, needs Hermes >= 0.23.0). The exact install command was not read | last push 2026-11-16 |
| Factory Droid 1.0 Script tool | https://factory.ai/news/frontier-harness | JavaScript sandbox; engine not named | yes. On by default for the models Factory tunes | "Droid implements PTC as a Script tool. The model writes JavaScript that runs in a sandbox with no file, network, or system access of its own." | no. The SDK reads `FACTORY_API_KEY` (`npm install @factory/droid-sdk`, 0.11.0) | Post dated 2026-10-26; @factory/cli 1.17.2, 2026-11-22 |
| Cloudflare MCP server portals Code Mode | https://developers.cloudflare.com/changelog/post/2026-03-26-mcp-portal-code-mode/ | Dynamic Worker (V8 isolate) | yes. On by default for portals | "The connected AI agent writes JavaScript that calls typed codemode.* methods for each upstream tool." | no. Needs a Cloudflare account (Access, then AI controls) | Changelog 2026-03-26 |
| Speakeasy Gram MCP gateway Code Mode | https://www.speakeasy.com/changelog?product=mcp-platform | Monty runner (`server/internal/codemode/README.md` in speakeasy-api/gram); gVisor or GKE isolation in production | yes | "A gateway can expose one execute tool that runs short Python scripts with live tool search, schema lookups, and authorized calls across every hosted, remote, and tunneled member, instead of handing an agent every member's full tool catalog up front." | no. The Gram README says "Code Mode is only for signed-in callers." The repo is AGPL-3.0, but self-hosting code mode was not verified | Changelog v1.48.3, 2026-10-28; repo push 2026-11-22 |
| camelRun (camelAI) | https://camelai.com/run/code-mode | V8 sandbox, a fresh process per execution (from the qaml-ai/run README) | yes: the model writes JS in `js_exec` and each MCP tool is `tools.<server>__<tool>()` | "On camelRun every agent gets it by default: the model writes JavaScript in js_exec, where each MCP tool is tools.<server>__<tool>()." | Hosted by default (`CAMELAI_API_KEY`, npm `@camelai/run` 0.23.1). The README says it is self-hostable with Docker plus Postgres, which I did not test | repo push 2026-11-22; @camelai/run 0.23.1, 2026-11-14 |
| AnythingMCP code mode | https://github.com/HelpCode-ai/anythingmcp/blob/main/docs/code-mode.md | Separate code-runner container with one locked-down subprocess per run; JS engine not named | yes: `amcp.run("tool", args)` inside the program | "Code mode lets an AI client run a short JavaScript program that orchestrates several of a workspace's MCP tools in one step, instead of making the tool calls one at a time." | partial. Self-host with Docker Compose (`COMPOSE_PROFILES=code-runner`). Inline `code_execute` is "Team and above", so it is licence-gated; saved code tools are capped on Community | @anythingmcp/cli 0.1.8, 2026-11-17; repo push 2026-11-22 |
| ToolHive Virtual MCP (vMCP) code mode | https://github.com/stacklok/toolhive/blob/main/examples/operator/virtual-mcps/vmcp_codemode.yaml | Starlark (`pkg/script`) | yes: `execute_tool_script`, with each inner call authorized separately | "Instead of issuing one tools/call per backend tool (with model inference between each), an agent submits a Starlark script that calls multiple tools server-side — with loops, conditionals, and parallel() fan-out — and receives a single aggregated result." | yes in principle. `thv vmcp serve --config vmcp.yaml` runs without Kubernetes (`docs/arch/vmcp-local.md`). The install command was not read | v0.67.1, 2026-11-21 |
| Redpanda Agentic Data Plane Code MCP server | https://docs.redpanda.com/agentic-data-plane/gateway/code-mode/ | JavaScript sandbox, engine not named (64 MiB, 10 s, 50 calls per run) | yes: `search` plus `execute` with a synchronous `call_tool` | "Run JavaScript in a sandbox that is connected to the member servers." | unknown. Part of a Redpanda product | Docs page created 2026-06-09 |
| TrueForge Code Mode (TrueFoundry) | https://trueforge.dev/key-features/code-mode | Python in a Daytona sandbox; MCP calls bridged back to the harness | yes | "Using the sandbox, the agent writes Python that calls MCP tools through an in-sandbox MCP client (mcp_client), processes the responses in code, and prints only what the user actually needs:" | no. The sandbox page says "Daytona is the only sandbox provider supported today." The harness repo is MIT | repo push 2026-11-22 |
| mcp-gway (deuriib/mcp-gateway) | https://github.com/deuriib/mcp-gateway/blob/main/docs/code-mode.md | Starlark | yes, but tiny (0 GitHub stars) | "`executeTool` — run Starlark with `Server.tool(param=value)`." | yes. `pip install mcp-gway==6.9.2` | 6.9.2 on PyPI, 2026-11-10 |
| Pydantic Logfire Agent Sandboxes | https://pydantic.dev/docs/logfire/agent-sandboxes/pydantic-ai/ | Hosted Monty | no: other. A hosted backend for the Pydantic `CodeMode` row above, not a separate implementation | "Pydantic AI’s Code Mode (a capability that turns an agent’s tools into functions the model can call from Python) gives the model one run_code tool, and Agent Sandboxes runs each script." | no. Needs `LOGFIRE_API_KEY` | not checked |
| OpenAI Agents SDK `ProgrammaticToolCallingTool` | https://github.com/openai/openai-agents-python/blob/main/docs/tools.md | Hosted V8 (OpenAI Responses) | no: other. An SDK wrapper over the already-covered OpenAI hosted PTC | "The generated program runs in a fresh hosted V8 environment." | no. Needs the OpenAI API | not checked |
| context-mode (`ctx_execute`) | https://github.com/mksglu/context-mode | Local process spawned on the user's runtimes | no: plain sandbox. Runs code and indexes the output, with no tool bridge | "The Context Mode plugin runs that work in a local sandbox, keeps the full output in a SQLite index on your machine, and gives the agent the part it asks for." | yes. npm `context-mode` 2.2.2 | 2.2.2 on npm, 2026-11-22 |
| Strands vended `python_repl` | https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/vended_tools/python_repl/types.py | Agent's configured sandbox (host by default, or Docker) | no: plain sandbox | "Each call runs in a fresh interpreter; variables, imports, and definitions do not persist across calls." | yes (part of Strands) | not checked |
| Zapier MCP `write_code_action` | https://docs.zapier.com/mcp/overview/how-tools-work | Zapier-hosted sandbox | no: other. Generates a code action against one app's API; it does not orchestrate MCP tools | "It creates a custom code action for an app when no built-in action matches the request, and runs the generated code in a secure sandbox with authenticated API access." | no. Zapier account | not checked |
| Uber MCP Gateway "Code Mode" (aifx) | https://www.uber.com/us/en/blog/designing-mcp-gateway/ | None; a CLI used from the shell | no: other. MCP exposed as a CLI whose output goes to files; internal to Uber | "Code Mode serves this pattern through aifx, Uber's CLI for agentic operations, routing MCP calls through the gateway without requiring any MCP server to be installed." | no. Internal | not checked |

## Checked, no code mode

Each line names the source checked. "Tree scan" means the default-branch file tree grep described in Method, with zero relevant hits.

Coding agents:
- Gemini CLI. Tree scan, https://github.com/google-gemini/gemini-cli. Its one hit was a false positive (`usePromptCompletion.ts`). A GitHub issue search for "code mode" found nothing relevant.
- Cline. Tree scan, https://github.com/cline/cline.
- Roo Code. Tree scan, https://github.com/RooCodeInc/Roo-Code. Its hits are Roo's "Code" persona mode, not code execution.
- Crush. Tree scan, https://github.com/charmbracelet/crush. The "code mode" issue hits are the CODE UI mode.
- Zed. Tree scan, https://github.com/zed-industries/zed.
- Continue. Tree scan, https://github.com/continuedev/continue.
- Aider. Tree scan, https://github.com/Aider-AI/aider.
- OpenHands. Tree scan, https://github.com/OpenHands/OpenHands. An issue search for "programmatic tool calling" returned 0.
- Kimi CLI. Tree scan, https://github.com/MoonshotAI/kimi-cli.
- Amp. https://ampcode.com/manual has no code-mode text. Amp's "Claude Code mode" is unrelated: it runs the Claude Agent SDK.
- trae-agent. Tree scan, https://github.com/bytedance/trae-agent.
- Plandex. Tree scan, https://github.com/plandex-ai/plandex.

Agent frameworks:
- CrewAI. Tree scan, https://github.com/crewAIInc/crewAI. `CodeInterpreterTool` was removed in favor of E2B or Modal. PR #6785 (`LLMSandboxTool`) was closed unmerged.
- Haystack. Tree scan, https://github.com/deepset-ai/haystack.
- Google ADK (Python, JS, Go). Tree scans of https://github.com/google/adk-python, https://github.com/google/adk-js and https://github.com/google/adk-go. Code executors are already covered as plain sandboxes.
- Semantic Kernel. Tree scan, https://github.com/microsoft/semantic-kernel.
- Spring AI. Tree scan, https://github.com/spring-projects/spring-ai. Every hit was `*Prompt*` filenames.
- LangChain.js. Tree scan, https://github.com/langchain-ai/langchainjs. The Python deepagents QuickJS row above has no JS counterpart in https://github.com/langchain-ai/deepagentsjs.
- Inngest AgentKit. Tree scan, https://github.com/inngest/agent-kit.
- VoltAgent. Tree scan, https://github.com/VoltAgent/voltagent.
- Genkit. Tree scan, https://github.com/firebase/genkit.
- BeeAI Framework. Tree scan, https://github.com/i-am-bee/beeai-framework.
- AG2. Tree scan, https://github.com/ag2ai/ag2.
- CAMEL. Tree scan, https://github.com/camel-ai/camel.
- Langroid. Tree scan, https://github.com/langroid/langroid.
- Upsonic. Tree scan, https://github.com/Upsonic/Upsonic.
- mcp-agent (lastmile). Tree scan, https://github.com/lastmile-ai/mcp-agent.

MCP gateways and proxies:
- MetaMCP. Tree scan, https://github.com/metatool-ai/metamcp.
- MCPJungle. Tree scan, https://github.com/mcpjungle/MCPJungle.
- Unla. Tree scan, https://github.com/AmoyLab/Unla.
- IBM ContextForge. Tree scan, https://github.com/IBM/mcp-context-forge.
- Obot. Tree scan, https://github.com/obot-platform/obot.
- Pomerium. Tree scan, https://github.com/pomerium/pomerium.
- Apify MCP server. Tree scan, https://github.com/apify/apify-mcp-server.
- Smithery CLI. Tree scan, https://github.com/smithery-ai/cli.
- LiteLLM. Tree scan, https://github.com/BerriAI/litellm.
- Portkey gateway. Tree scan, https://github.com/Portkey-AI/gateway.
- Envoy AI Gateway. Tree scan, https://github.com/envoyproxy/ai-gateway.
- Microsoft mcp-gateway. Tree scan, https://github.com/microsoft/mcp-gateway.
- Lasso MCP gateway. Tree scan, https://github.com/lasso-security/mcp-gateway.
- Klavis. Tree scan, https://github.com/Klavis-AI/klavis.
- MCP Router. Tree scan, https://github.com/mcp-router/mcp-router.
- mcp-proxy (TBXark and sparfenyuk). Tree scans of https://github.com/TBXark/mcp-proxy and https://github.com/sparfenyuk/mcp-proxy.

## Dropped or unverified

- DSPy `CodeAct`. Removed in DSPy 3.5. Commit "Remove deprecated CodeAct and ProgramOfThought for 3.5 (#10780)" is dated 2026-11-03, per the GitHub commits API for `dspy/predict/code_act.py`. `RLM` with `tools=` replaces it (row above).
- Kilo Code `packages/codemode`. Its `package.json` names it `@opencode-ai/codemode` ("Effect-native confined code execution over schema-described tools"; JS interpreted over an `acorn` AST). It is a vendored copy of OpenCode's package, which another worker owns. I did not verify that Kilo's agent exposes it to the model.
- MintMCP (renamed Mintive per a competitor page). Code mode is claimed only on third-party pages. No MintMCP primary source was found.
- Warp, Augment, Jules, Devin, GitHub Copilot CLI, Cursor CLI. Closed source. A web search found no code-mode or PTC claim, and I did not read their docs page by page. `github/copilot-cli` holds only 28 files, so the tree scan says nothing about the product. Cursor is already covered in `probes/results/cursor.json`.
- jx-codes/codemode-mcp. Its README says it was abandoned in favor of Lootbox, which is already covered.
- The Cline MCP marketplace lists a "Code Mode" entry that looks like UTCP code-mode, which is already covered. Not opened.
- A self-hosted gateway seen in a Reddit r/mcp post ("~700 tokens vs ~9,100"). Search snippet only; the repo was not identified.

## Hands-on status (2026-11-22)

Probed with SPEC.md and RUBRIC.md, results in `probes/results/`:
- langchain-quickjs 0.4.0: `results/langchain-quickjs.json`. Passes G1, G2 and G3 in default and hardened configs.
- Pydantic AI Harness `CodeMode` 0.71.0: `results/pydantic-ai-harness-codemode.json`. Passes G1, G2 and G3 in default and hardened configs.

Runs locally without an account, not yet probed (follow-up): Strands harness `programmatic_tool_caller`, DSPy `RLM(tools=...)`, Qwen Code `codeModeOnly`, OpenClaw Code Mode, Agno `CodeMode`, Pydantic `IPythonCodeMode`, Hermes Agent `execute_code`, ToolHive vMCP, mcp-gway.

Needs an account or a paid plan (list only): Factory Droid Script tool, Cloudflare MCP server portals, Speakeasy Gram, camelRun (hosted; self-host untested), AnythingMCP inline `code_execute`, Redpanda Agentic Data Plane, TrueForge.
