# Code-mode implementations the survey missed

Sweep date: 2026-11-22. Scope: anything not already in `research/code-mode-survey.md`.

Every row was read from a primary source in this session: the project's own repo, docs, or blog. A sweep subagent read most rows. I re-fetched the page and matched the quoted sentence for the rows marked **re-checked**. The other rows rest on the subagent's reading and are not independently re-verified.

Category (a) is true code mode: model-written code calls host tools from inside a sandbox, and only what the code returns or prints reaches the model. Category (b) is a code-execution sandbox with no built-in tool bridge.

## (a) Code mode

| Name | Primary URL | Language | Sandbox / engine | Discovery | What is distinctive | Check |
|---|---|---|---|---|---|---|
| Claude Code Code Mode (experimental) | https://code.claude.com/docs/en/code-mode | JavaScript | Runs in the Claude Code process; JS and its file, web and MCP calls run outside the Bash sandbox | Not documented | First-party code mode inside Claude Code (v2.1.323+, REPL tool). "Claude writes a piece of JavaScript that makes the tool calls, and Claude Code runs that code in your session." | re-checked |
| Vercel AI SDK Code Mode (`@ai-sdk/code-mode`) | https://ai-sdk.dev/docs/ai-sdk-core/code-mode | JS/TS | QuickJS, fresh context per call | TS signatures in the tool definition, or a catalog message with `toolDiscovery: 'conversation'` | Built into the AI SDK. "The generated code runs in an isolated QuickJS sandbox and returns a JSON-serializable result." | re-checked |
| Vercel Run SDK | https://github.com/vercel-labs/run | JS, type-stripped TS | QuickJS in a worker thread | Host functions become globals | The execution layer under the AI SDK code mode, usable alone. "Guest code can access only the host functions you provide." | |
| Mastra Code Mode (`createCodeMode`) | https://mastra.ai/docs/agents/code-mode | TS | LocalSandbox, E2B, isolated-vm, or QuickJS | Generated instructions, all tools upfront | Tools still run on the host with validation and tracing. "Each external_* call is bridged back to the real tool on the host" | re-checked |
| TanStack AI Code Mode | https://tanstack.com/ai/latest/docs/code-mode/code-mode.md | TS | Drivers for Node, QuickJS, QuickJS Bun, Cloudflare, Daytona, E2B | System prompt; "Lazy Tools" keep rare tools out | Swappable isolate drivers. "The Node, QuickJS, QuickJS Bun, and Cloudflare drivers have no access to the host file system, network, or process." | re-checked |
| ctx-zip | https://github.com/karthikscale3/ctx-zip | TS | E2B, Vercel, or local sandbox | Filesystem of generated tool code (`sandbox_ls`, `sandbox_cat`, `sandbox_grep`) | The filesystem-discovery form of Anthropic's MCP pattern, for the AI SDK | |
| LangGraph CodeAct (archived) | https://github.com/langchain-ai/langgraph-codeact | Python | Bring your own (`eval` in the demo, Pyodide example) | Tools in the system prompt | LangChain's official CodeAct; Python variables persist between turns. Repo is archived. | repo state re-checked |
| LlamaIndex `CodeActAgent` | https://developers.llamaindex.ai/python/examples/agent/code_act_agent/ | Python | Caller supplies `code_execute_fn`; the example uses in-process `exec` | Functions passed in, upfront | Prebuilt CodeAct agent; sandboxing is left to you. "the agent will write code that uses those functions to help complete the task" | re-checked |
| Microsoft Agent Framework CodeAct (Hyperlight, alpha) | https://devblogs.microsoft.com/agent-framework/codeact-with-hyperlight/ | Python | Hyperlight micro-VM per call | `build_instructions()` puts tools in the prompt | Microsoft first-party. "Hyperlight bridges the call back out to your runtime, runs your tool there, and returns the result into the sandbox." | re-checked |
| AutoGen code executors with `functions` | https://github.com/microsoft/autogen | Python | Local subprocess/venv or Docker | Function stubs in the prompt | Borderline: functions are written into an importable module inside the executor, not called back over RPC | |
| FastMCP `CodeMode` transform (experimental) | https://gofastmcp.com/docs/servers/transforms/code-mode | Python | pydantic-monty | BM25 search tool, `GetSchemas`, `GetTags`, `ListTools` | Turns any FastMCP server into search plus execute. "Inside the sandbox, call_tool(name, params) is the only function available." | re-checked |
| Docker MCP Gateway `code-mode` (experimental) | https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/ | JS | goja, a pure-Go JS interpreter (`pkg/codemode/exec.go` imports `github.com/dop251/goja`) | `mcp-find` / `mcp-add` | Model composes a JS tool over chosen MCP servers that run in containers. "Code mode runs agent-written JavaScript in an isolated sandbox that can only interact through MCP tools" | re-checked (docs .md and source) |
| Stainless-generated MCP servers (example: Mux) | https://github.com/muxinc/mux-node-sdk/blob/master/packages/mcp-server/README.md | TS against the generated SDK | Deno locally, or a remote sandbox | Docs search tool | Code is written against a real SDK, not tool stubs. "executed in a sandbox environment without web or filesystem access" | |
| Kong Context Mesh | https://developer.konghq.com/context-mesh/ | Not stated | Not stated | SDK-like interface | Builds one code-mode MCP server from OpenAPI specs plus existing MCP servers. "a single Code Mode MCP server" | re-checked |
| agentgateway code mode | https://www.solo.io/blog/agentgateway-code-mode-for-openapi-to-mcp | JS (`run_code`) | "embedded runtime sandbox", engine not named | Typed API generated from authorized tools | Access control enforced twice: hidden from the generated API and rejected at runtime | re-checked |
| Bifrost MCP Gateway Code Mode | https://docs.getbifrost.ai/mcp/code-mode | Python subset (Starlark) | Starlark interpreter | Four meta-tools: `listToolFiles`, `readToolFile`, `getToolDocs`, `executeToolCode` | Publishes a benchmark. 96 tools: 64/64 pass both ways, input tokens 19.9M to 8.3M (-58.2%). 508 tools: 75.1M to 5.4M tokens, 65/65 pass | re-checked (numbers too) |
| Composio Remote Sandbox | https://docs.composio.dev/docs/sandbox/remote | Python | Persistent remote sandbox, engine not stated | `SEARCH_TOOLS` meta-tool | Hosted SaaS tool catalog; code can also call an LLM helper. "programmatic access to all Composio tools" | re-checked |
| Symbolica Agentica SDK | https://docs.symbolica.ai/concepts/how-it-works | Python | Sandboxed Python REPL, engine not stated | Signatures of in-scope functions in the prompt | Live objects passed by reference as proxies. "Functions you pass in scope appear in the sandbox as stubs, but execute in your runtime" | re-checked |
| Pi coding agent `codemode` | https://github.com/earendil-works/pi (`packages/codemode/README.md`) | JS | QuickJS compiled to WASM, a worker per run | `ALL_TOOLS` global; TS declaration catalog | Inside a widely used coding agent. "Nested tool calls never enter the LLM context; only the script's output and return value do." | re-checked |
| mitsuhiko/pi-codemode-mcp | https://github.com/mitsuhiko/pi-codemode-mcp | JS | Not stated | `list_mcp_tools` with text or regex query | A negative result: "with how MCP works today, such efficiency gains are not useful." | re-checked |
| Lootbox | https://github.com/jx-codes/lootbox | TS | Separate Deno worker processes | `lootbox tools types <ns>` | Saved scripts become reusable tools | |
| shift-labs-ai/codemode | https://github.com/shift-labs-ai/codemode | JS | Worker thread; the README says it is not a sandbox | `actions.find()` / `actions.describe()` from inside code | Discovery happens inside the program, not in the prompt | |
| janwilmake/agent-codemode | https://github.com/janwilmake/agent-codemode | TS scripts | None; runs in your shell | `types --all` emits typed clients | Reuses the coding agent's existing MCP logins | |
| Open-PTC | https://github.com/daly2211/open-ptc | TS | Deno isolate or restricted Deno subprocess | One `code_executor`; tool list over HTTP | OpenAI-compatible proxy that adds PTC to any app | |
| cmcp | https://github.com/assimelha/cmcp | TS (types stripped by oxc) | QuickJS, 64 MB memory limit | `search()` where the model writes filter code over the catalog | Rust proxy putting every MCP server behind two tools | |
| Forgemax | https://github.com/postrv/forgemax | JS | V8 isolate via `deno_core`, separate worker process | `search` over a capability manifest | Gateway with bounded parallel calls | |
| VoidMCP | https://github.com/voidmind-io/voidmcp | JS | QuickJS in WASM, Go host | `search` then `execute_code` | Single Go binary | |
| My Cool Proxy | https://github.com/karashiiro/my-cool-proxy | Lua | Lua interpreter | Progressive-disclosure meta-tools | The only Lua-based gateway found | |
| CodeMode Unified | https://github.com/danieliser/codemode-unified | JS/TS | Bun, QuickJS, Deno, isolated-vm, or E2B | MCP servers from config | Pick the runtime | |
| Datalayer Agent Codemode | https://github.com/datalayer/agent-codemode | Python | eval, monty, docker, jupyter, modal, and others | `search_tools` with deferred loading | Typed Python bindings generated from MCP servers | |
| modus-data/mcp_codemode | https://github.com/modus-data/mcp_codemode | TS | E2B and others | A small LLM pre-filters the catalog | Three-model pipeline: plan, filter, write code | |
| Protocol-Lattice go-agent | https://github.com/Protocol-Lattice/go-agent | Expr programs | UTCP runtime, "trusted environments" only | Ranking model picks the tool | Go framework with UTCP code mode | |
| imran31415/codemode_python_benchmark | https://github.com/imran31415/codemode_python_benchmark | Python | RestrictedPython | Not stated | The survey cited this benchmark as unverified. README: 144,250 vs 45,741 tokens (68.3% fewer), success 6/8 vs 7/8 | re-checked (numbers too) |

## (b) Code-execution sandboxes without a built-in tool bridge

| Name | Primary URL | Language | Sandbox / engine | Note |
|---|---|---|---|---|
| LangChain Sandbox (archived) | https://github.com/langchain-ai/langchain-sandbox | Python | Pyodide on Deno | Was the sandbox in the LangGraph CodeAct example |
| Google ADK code executors | https://adk.dev/integrations/code-execution/ | Python | Gemini built-in, Agent Engine sandbox, container, GKE, Vertex, unsafe local | No tool bridge |
| Letta `run_code` | https://docs.letta.com/v1-sdk/tools/builtin-tools | Python, JS, TS, R, Java | Sandbox | "Execute code in a secure sandbox with full network access." (re-checked) |
| OpenAI Agents SDK Sandbox Agents | https://openai.github.io/openai-agents-python/sandbox_agents/ | Shell and files | Unix-local, Docker, or hosted | Workspace agent, not code mode |
| E2B plus MCP gateway | https://docs.e2b.dev/mcp-gateway | Any | E2B VM | Borderline: an in-sandbox gateway makes MCP tools reachable from code |
| Daytona | https://www.daytona.io/docs/en/ | Python, TS, JS | Full sandboxes | Also a TanStack driver |
| Modal Sandboxes | https://modal.com/docs/guide/sandboxes | Any | gVisor | Plain sandbox |
| Deno Sandbox | https://deno.com/blog/introducing-deno-sandbox | Any | Linux microVMs on Deno Deploy | Secrets stay placeholders until an allowed host is called (re-checked "lightweight Linux microVMs") |
| AWS Bedrock AgentCore Code Interpreter | https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-tool.html | Python, JS, TS | Container | Plain sandbox |

## Dropped or unverified

- Harbor SDK, MCPorter: sandbox or tool bridge not confirmed.
- OpenHands CodeActAgent: not found in the current OpenHands main tree.
- Pydantic AI Harness `CodeMode`, Logfire sandboxes, Docker Sandboxes `code-mode`: search snippets only.
- Semantic Kernel: no code-mode feature found.
- About fifteen small GitHub repos seen only in search descriptions.

## What matters for the benchmark

- Two first-party harnesses added code mode since the survey: Vercel's AI SDK and Claude Code. Microsoft has an alpha.
- QuickJS is the most common engine in new implementations (AI SDK, Run, TanStack, Pi, cmcp, VoidMCP, Mastra option).
- Bifrost and the imran31415 benchmark publish token and pass-rate numbers. mitsuhiko's repo is the one negative result found.
