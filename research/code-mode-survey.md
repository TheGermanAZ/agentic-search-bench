# Code mode and agentic search across harnesses: a survey

Research date: 2026-11-21. All sources below were fetched and read on that date unless marked **unverified**.
Scope: how agent harnesses retrieve from large corpora. Three architectures are compared.

- **Classic RAG.** A fixed pipeline embeds and indexes chunks. The harness retrieves top-k chunks and pastes them into the prompt. The model does not choose the query or the number of searches.
- **Agentic search.** The model drives search tools in a loop (grep, glob, read, a search API). It picks queries, reads results, and refines. Every tool result enters the context window.
- **Code mode.** The model writes a program against a typed API. The program runs in a sandbox. Tool calls happen inside the program. Only what the program prints or returns enters the context window.

A note on terms. "Agentic search" and "RAG" overlap. Simon Willison argued on Hacker News that grep-driven retrieval is still retrieval-augmented generation, and another commenter drew the line at who controls the search loop ([HN thread](https://news.ycombinator.com/item?id=43163011)). This report uses the loop-control definition.

---

## Key findings

1. **Code mode is now a first-party API feature at both Anthropic and OpenAI.** Anthropic runs Python in a code execution container ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). OpenAI runs JavaScript in a fresh V8 isolate with no network and no filesystem ([OpenAI PTC docs](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)). Cloudflare started the pattern in September 2025 ([Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/)).
2. **The biggest measured wins are in context size, not accuracy.** Anthropic reports 150,000 to 2,000 tokens (98.7%) for tool definitions ([code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)). Cloudflare reports about 1,000 tokens for 2,500+ API endpoints ([Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)). Accuracy gains are smaller: 25.6% to 28.5% on Anthropic's internal knowledge retrieval eval ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)).
3. **On a 6M to 11M token corpus, putting the corpus in an environment beats putting it in the prompt.** On BrowseComp-Plus with 1,000 documents, GPT-5 scores 91.3 as a Recursive Language Model (code over a context variable) and 94.0 in OpenCode with the corpus offloaded to a file. CodeAct with a BM25 retriever scores 51.0. The base model scores 0.0 because it hits the context limit ([RLM paper, Table 1](https://arxiv.org/html/2512.24601v3)).
4. **Grep alone is not the answer for exact lookups at scale, and embeddings alone are not either.** Cursor measures +12.5% average accuracy when semantic search is added to grep ([Cursor semsearch](https://cursor.com/blog/semsearch)). Cursor also sees ripgrep calls over 15 seconds in large monorepos and built a local n-gram index for regex ([Cursor fast regex](https://cursor.com/blog/fast-regex-search)). BrowseComp-Plus shows a dense retriever lifting GPT-5 from 55.9% to 70.1% over BM25 ([BrowseComp-Plus](https://arxiv.org/abs/2508.06600)).
5. **Claude Code's no-index decision rests on operational reasons as much as accuracy.** Boris Cherny cited stale indexes, security, and liability, and called the accuracy evidence "mostly vibes" plus some internal benchmarks ([Latent Space](https://latent.space/p/claude-code/)). That reasoning does not transfer to a 30M-file evidence store that must be indexed anyway.

---

## 1. Cloudflare Code Mode

### 1a. Agents SDK Code Mode (September 2025)

Source: [blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/), published 2025-09-26, by Kenton Varda and Sunil Pai.

- **What the model writes.** TypeScript. The Agents SDK fetches each MCP server's schema and converts it into a TypeScript API with doc comments. The model gets one tool that executes TypeScript.
- **Where it runs.** A V8 isolate created through the Worker Loader API. Cloudflare says an isolate "can start in a handful of milliseconds using only a few megabytes of memory." A new isolate is created per snippet and thrown away.
- **Isolation and network.** The sandbox is "totally isolated from the Internet." Global `fetch()` and `connect()` throw errors. The only path out is through bindings that represent connected MCP servers. Bindings hold credentials, so "the AI cannot possibly write code that leaks any keys."
- **What reaches the model.** Output of `console.log()`. "When the script finishes, all the output logs are passed back to the agent."
- **Discovery.** All schemas upfront. "Currently, the entire API is loaded, but future improvements could allow an agent to search and browse the API more dynamically."
- **State.** None between snippets. Isolates are disposable by design.
- **Numbers.** No quantitative benchmark in the post. The claims are qualitative: agents handle "many more tools, and more complex tools" as a TypeScript API.

The stated rationale: LLMs have seen far more real code than synthetic tool-call tokens. "Making an LLM perform tasks with tool calling is like putting Shakespeare through a month-long class in Mandarin and then asking him to write a play in it."

### 1b. Server-side Code Mode MCP server (February 2026)

Source: [blog.cloudflare.com/code-mode-mcp](https://blog.cloudflare.com/code-mode-mcp/), published 2026-02-20.

- **What the model writes.** JavaScript async arrow functions passed to two tools: `search()` and `execute()`.
- **Discovery.** `search()` runs model-written JavaScript against a typed form of the OpenAPI spec. "The full OpenAPI spec never enters the model context. The agent only interacts with it through code." This is discovery by code, not by a fixed search tool.
- **Where it runs.** A Dynamic Worker isolate with "no file system, no environment variables to leak through prompt injection and external fetches disabled by default."
- **Numbers.** The Cloudflare API has over 2,500 endpoints. The body says an equivalent MCP server without Code Mode would use 1.17 million tokens. Code Mode uses about 1,000 tokens, a 99.9% reduction. The page's meta description says "over 2 million tokens" instead. The two figures disagree on the same page.
- **What reaches the model.** Not stated in the text I extracted. **Unverified.**

---

## 2. Anthropic: code execution with MCP, and programmatic tool calling

### 2a. "Code execution with MCP" (engineering post, pattern, not a product)

Source: [anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp), published 2025-11-04, by Adam Jones and Conor Kelly.

- **What the model writes.** TypeScript that imports generated wrapper files, one file per MCP tool, under `./servers/<server>/<tool>.ts`. Each wrapper calls `callMCPTool`.
- **Discovery (progressive disclosure).** "The agent discovers tools by exploring the filesystem: listing the `./servers/` directory... then reading the specific tool files it needs." An alternative is a `search_tools` tool with a detail-level parameter (name only, name and description, or full schema).
- **The headline number.** Loading only needed definitions "reduces the token usage from 150,000 tokens to 2,000 tokens, a time and cost saving of 98.7%." This is an illustrative example in the post, not a benchmark suite.
- **What reaches the model.** "The agent only sees what you explicitly log or return." The example filters a 10,000-row sheet in code and logs five rows.
- **Privacy.** The harness can tokenize PII before it reaches the model, for example `[EMAIL_1]`, and untokenize it when passed to another tool. Real values flow between tools "but never through the model."
- **State.** Filesystem access lets agents write intermediate results to files and save reusable functions as skills.
- **Where it runs.** The post does not name a sandbox. It says agent code "requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring," and that this adds operational overhead.

### 2b. Advanced tool use on the Claude API (Tool Search Tool, Programmatic Tool Calling, Tool Use Examples)

Source: [anthropic.com/engineering/advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use), published 2025-11-24, written by Bin Wu. Beta header `advanced-tool-use-2025-11-20`.

**Tool Search Tool.**
- Tools are marked `defer_loading: true` and stay out of context until found. The platform ships regex and BM25 search variants. Custom search, including embeddings, is allowed.
- Numbers: a five-server setup (GitHub, Slack, Sentry, Grafana, Splunk) is 58 tools and about 55K tokens. Anthropic has seen 134K tokens of tool definitions internally. With tool search, total context use before work drops from about 77K to about 8.7K tokens, an 85% reduction.
- Accuracy on internal MCP evals: Opus 4 from 49% to 74%; Opus 4.5 from 79.5% to 88.1%.
- Deferred tools do not break prompt caching because they are excluded from the initial prompt.

**Programmatic Tool Calling (PTC).**
- **What the model writes.** Python. "The API converts these tool definitions into Python functions that Claude can call." The example uses `asyncio.gather` for parallel calls.
- **Where it runs.** The Code Execution tool, "a sandboxed environment." The script pauses at each tool call. The client receives a `tool_use` block with a `caller` field and returns the result to the script, not to the model.
- **What reaches the model.** Only `stdout` in a `code_execution_tool_result`. In the budget example, 2,000+ expense line items stay out of context, "reducing consumption from 200KB of raw expense data to just 1KB of results."
- **Opt-in.** Each tool lists `allowed_callers: ["code_execution_20250825"]`.
- **Numbers.** Average tokens on complex research tasks fell from 43,588 to 27,297 (37%). Internal knowledge retrieval rose from 25.6% to 28.5%. GIA rose from 46.5% to 51.2%.
- **Anthropic's own guidance.** PTC is "less beneficial" for "tasks where Claude should see and reason about all intermediate results" and for "quick lookups with small responses."

**Tool Use Examples.** Example inputs in tool definitions raised accuracy on complex parameter handling from 72% to 90%.

### 2c. PTC API docs (current behavior)

Source: [platform.claude.com PTC docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling).

- Python, run "in a sandboxed container through code execution."
- **State.** "A new container is created for each request unless you reuse an existing one." Passing the container ID keeps state. Containers expire 30 days after creation. After about 5 minutes of inactivity a container is checkpointed and can be restored within the 30-day window.
- **Limits.** Tools with `strict: true` are not supported. `tool_choice` cannot force programmatic calls. Tools from an MCP connector cannot be called programmatically. Results for programmatic calls must be strings or text blocks; images and documents are rejected. Claude Haiku 4.5 does not support PTC.
- **Network access** inside the container is not described in the text I extracted. **Unverified.**

---

## 3. Claude Code: agentic search instead of a vector index

### What Anthropic people said

- **Boris Cherny, Hacker News, 2025-02-24:** "Right -- Claude Code doesn't use RAG currently. In our testing we found that agentic search out-performed RAG for the kinds of things people use Code for." ([HN launch thread](https://news.ycombinator.com/item?id=43163011), comment [43164253](https://news.ycombinator.com/item?id=43164253))
- **Boris Cherny, Latent Space podcast** ([latent.space/p/claude-code](https://latent.space/p/claude-code/)):
  - Early versions used off-the-shelf RAG: "we indexed the code base, and I think we were just using Voyage."
  - Reason one: "it outperformed everything. By a lot." Asked "In what benchmark?", he answered: "This was just vibes, so internal vibes. There's some internal benchmarks also, but mostly vibes."
  - Reason two: the indexing step adds complexity "because the code drifts out of sync."
  - Reason three: "security issues because this index has to live somewhere... what if that provider gets hacked?"
  - Trade-off: "at the cost of latency and tokens, you now have really awesome search without security downsides."
- **Cat Wu, Every "AI & I" transcript, 2025-10-29** ([every.to transcript](https://every.to/podcast/transcript-how-to-use-claude-code-like-the-people-who-built-it)): "initially we did use vector embeddings. They're just really tricky to maintain because you have to continuously re-index the code." She adds that enterprise adoption "exposes a lot more surface area and security risk," and that "you can get to the same accuracy level with agentic search and it's just a much cleaner deployment story." Semantic search can still be added "via an MCP tool."
- **Pragmatic Engineer summary, 2026-03-04** ([newsletter](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)): the team tried "local vector databases, recursive model-based indexing, and other fancy approaches. All had downsides (stale indexes, permission complexity). Plain glob and grep, driven by the model, beat everything." The idea came from watching Instagram engineers search code when click-to-definition was broken.
- **Boris Cherny on X**: a search snippet attributes to him "Early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better." The page failed to load. **Unverified.**

### What the harness does today

Source: [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference).

- On macOS, Linux, and WSL, Glob and Grep are left out of the default tool set. "Claude searches with find and grep through the Bash tool instead. In Claude's shell those two commands run embedded versions of bfs and ugrep."
- The Grep tool, when enabled, "is built on ripgrep." It has three output modes: file paths only (default), matching lines, and counts.
- Glob results are "sorted by modification time and capped at 100 files."
- No semantic index tool is documented on that page.

### Harness mapping

| Property | Claude Code |
|---|---|
| Model writes | Shell commands (find, grep via embedded bfs and ugrep), or Grep/Glob/Read tool calls |
| Runs where | User's machine |
| What returns | Full tool output into context (Grep output modes and Glob's 100-file cap limit size) |
| Discovery | Fixed built-in tools; MCP tool search for deferred tools |
| State | The filesystem |
| Numbers | Qualitative only from Anthropic. Third-party: 84.0 on BrowseComp-Plus 1K with Claude Opus 4.1 and the corpus offloaded to a file ([RLM paper](https://arxiv.org/html/2512.24601v3)) |

---

## 4. Cursor: semantic search plus grep, and an index for grep

### 4a. "Improving agent with semantic search"

Source: [cursor.com/blog/semsearch](https://cursor.com/blog/semsearch), by Stefan Heule, Emily Jia, and Naman Jain. The publication date was not on the scraped page.

- Cursor trained its own embedding model. Training data comes from agent traces: an LLM ranks what would have helped at each step, and the embedding model is trained to match those rankings.
- **Offline eval (Cursor Context Bench).** "On average 12.5% higher accuracy in answering questions (6.5%–23.5% depending on the model)" with semantic search added to grep. Gains appeared "across all models we tested."
- **Online A/B test.** Code retention rose 0.3% with semantic search, and 2.6% on codebases with 1,000 or more files. Dissatisfied follow-up requests rose 2.2% without semantic search.
- **Conclusion.** "Our agent makes heavy use of grep as well as semantic search, and the combination of these two leads to the best outcomes."

### 4b. "Fast regex search: indexing text for agent tools"

Source: [cursor.com/blog/fast-regex-search](https://cursor.com/blog/fast-regex-search), by Vicent Marti.

- Problem: ripgrep "needs to match on the contents of all files." In large enterprise monorepos, "We routinely see `rg` invocations that take more than 15 seconds."
- Design: an inverted index keyed by sparse n-grams (variable-length, deterministic pseudo-random selection) instead of plain trigrams. The index lives on the user's machine. A sorted hash table is `mmap`ed and queried by binary search.
- Conclusion: "`grep` is one of the few Agent operations whose latency scales with the size and complexity of the code being worked on."
- No measured speedup figures were in the text I extracted. **Unverified.**

This is the most relevant prior art for a 20M to 30M file corpus. The agent keeps a grep-shaped tool. The harness answers it from an index.

---

## 5. OpenAI: Codex CLI, Code Interpreter, and Programmatic Tool Calling

### 5a. Codex CLI

- **Search approach.** The Codex system prompt says: "When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`." ([gpt_5_codex_prompt.md](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md), same text in the [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)).
- **Main tool.** "For coding tasks, the most commonly used tool is a shell tool." The one-shot `exec_command` tool returns `{"output", "exit_code"}` with stderr merged into stdout ([Inside the Codex sandbox](https://openai.com/index/inside-the-codex-sandbox/), 2026-11-18, Michael Bolin).
- **Sandbox.** Codex does not use containers or VMs. It constrains commands in the user's own environment. macOS uses Seatbelt via `sandbox-exec` with a `(deny default)` base profile. Linux uses bubblewrap plus seccomp-bpf. Windows is moving to Microsoft's MXC library ([same source](https://openai.com/index/inside-the-codex-sandbox/)).
- **Network.** The default `:workspace` profile "Disables network access." An optional proxy enforces per-domain allow and deny rules, and resolves DNS only after a domain is approved.
- **Index.** I found no embedding or index tool in the Codex sources I read. "Codex has no index" is an inference from absence. **Unverified.**
- **Code mode inside Codex.** None found in these sources. Codex is pure agentic shell search.

### 5b. Code Interpreter (Responses API)

Source: [OpenAI Code Interpreter docs](https://developers.openai.com/api/docs/guides/tools-code-interpreter).

- Python in a container described as "a fully sandboxed virtual machine."
- Memory tiers: 1g (default), 4g, 16g, 64g.
- State persists while the container is active. "A container expires if it is not used for 20 minutes," and in-memory Python objects are then lost.
- Generated files return as `container_file_citation` annotations.
- Network policy inside the container is not stated on the page. **Unverified.**
- This is code execution over files, not code calling your tools. It is the older pattern.

### 5c. Programmatic Tool Calling (Responses API and Agents API)

Source: [OpenAI PTC docs](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling).

- **What the model writes.** JavaScript with top-level `await`. Tools appear as `tools.*`.
- **Where it runs.** "OpenAI runs each generated program in a fresh, isolated V8 runtime." It has no Node.js, no package installation, no direct network, no general filesystem, no subprocesses, no console, and "no persistent JavaScript state between program executions."
- **What reaches the model.** Only what the program emits with `text(...)` or `image(...)`. This arrives as a `program_output` item.
- **Discovery.** Tool search runs as a top-level tool, not from inside a program. Deferred tools must be loaded before a program that needs them starts.
- **Typed outputs.** Tools can declare an `output_schema` so generated code can rely on return fields.
- **OpenAI's routing guidance**, quoted from the docs table:
  - "Adaptive search or semantic evaluation": use direct tool calling.
  - Results that code can "filter, join, rank, remove duplicates from, aggregate, or validate": use PTC.
  - "Final citation or native artifact validation": use direct tool calling "unless the program preserves the native output and validates every required item."
- **Agents API.** PTC is on by default. The harness gives the agent an `exec` tool.
- **Numbers.** None on the page. The docs tell users to measure correctness and evidence coverage before efficiency.

---

## 6. CodeAct paper and Hugging Face smolagents

### 6a. CodeAct (Wang et al., ICML 2024)

Source: [arXiv 2402.01030](https://arxiv.org/abs/2402.01030), [HTML v4](https://arxiv.org/html/2402.01030v4), code at [github.com/xingyaoww/code-act](https://github.com/xingyaoww/code-act).

- Actions are executable Python, run in an interpreter over multiple turns, instead of JSON or text tool calls.
- Evaluated on 17 LLMs, on API-Bank and a new benchmark, M3ToolEval, which "contains 82 human-curated instances."
- Headline: "up to a 20% absolute improvement over baselines on the success rate... while requiring up to 30% fewer actions."
- Best model: "gpt-4-1106-preview achieves a 20.7% absolute improvement compared to the next best action format (text) while requiring 2.1 fewer interaction turns on average."
- CodeAct had higher success for 12 of 17 models. It did not win for all models.
- The authors also release CodeActInstruct (7k multi-turn interactions) and CodeActAgent, fine-tuned from Llama 2 and Mistral.

### 6b. smolagents CodeAgent

Sources: [smolagents intro](https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents), [secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution).

- **What the model writes.** Python code actions. The docs cite CodeAct and list composability, object management, generality, and training-data coverage as reasons.
- **Where it runs.** A custom local Python interpreter by default. "By default, imports are disallowed unless they have been explicitly added to an authorization list." Submodules need explicit authorization. "The total count of elementary operations processed is capped." Any operation not defined in the interpreter raises an error.
- **Remote sandboxes.** Blaxel, E2B, Modal, and Docker.
- **What reaches the model.** For sandboxed execution, "only the output will be returned." Print logs are captured.
- **State.** For remote execution, the docs say the solution "sends the agent state to the server at the start of each `agent.run()`." Whether Python variables persist across steps in the local executor was not in the text I extracted. **Unverified.**
- **Numbers.** No smolagents-specific benchmark in these pages.

---

## 7. Other code-mode implementations (confirmed from primary sources)

### 7a. Block goose Code Mode

Source: [goose blog, 2025-12-15](https://goose-docs.ai/blog/2025/12/15/code-mode-mcp).
- JavaScript or TypeScript, run in [Boa](https://github.com/boa-dev/boa), "an embeddable JavaScript engine."
- Three tools: search available modules and tool source, read a tool's source, and execute code.
- "The model can progressively discover relevant tools, without all server and tool definitions in the context window from the beginning."
- Intermediate results chain "without the intermediate results needing to flow back to the model."
- No token numbers. State persistence not described.

### 7b. Executor (Rhys Sullivan, UsefulSoftwareCo)

Sources: [GitHub README](https://github.com/UsefulSoftwareCo/executor), [MCP docs](https://executor.sh/docs/mcp).
- Agents get two tools, `skills` and `execute`. "They search for what they need and run a short program across as many apps as the task takes."
- JavaScript in "a sandboxed interpreter." It has "no `fetch`, no `process`, no filesystem, no timers and no imports. Its only way out is a tool call."
- Honest caveat in the docs: "Limits are cooperative, not process isolation."
- Discovery: `tools.search` finds tools by words in paths and descriptions. `describe` returns full signatures.
- Returns "what the program returns." Tools that need approval pause the program; `resume` continues it.
- Fixed limits: 65,536 characters of source, 100 tool calls, 5 minutes.
- Credentials stay in Executor. "The agent never sees the credential."

### 7c. UTCP code-mode

Source: [github.com/universal-tool-calling-protocol/code-mode](https://github.com/universal-tool-calling-protocol/code-mode).
- TypeScript, run with "Node.js VM sandboxing." Commit history mentions `isolated-vm`.
- Discovery: `searchTools('github pull request')`, plus `__interfaces` and `__getToolInterface()` inside code.
- Returns `{result, logs}` with captured console output.
- The README cites a third-party benchmark ([imran31415/codemode_python_benchmark](https://github.com/imran31415/codemode_python_benchmark)): 67%, 75%, and 88% faster for simple, medium, and complex scenarios, and "$9,536/year cost savings." I did not read that benchmark repo. **Unverified.**

### 7d. Pydantic: mcp-run-python (archived) and Monty

- **mcp-run-python** ran Python in Pyodide inside Deno. Pydantic has retired it: "there's just no safe way to run Python within pyodide safely with reasonable latency." Pyodide code "can run arbitrary javascript," can read files the runtime can reach, and can exhaust memory ([GitHub README](https://github.com/pydantic/mcp-run-python)).
- **Monty** ([Pydantic article, 2026-02-27, Samuel Colvin](https://pydantic.dev/articles/pydantic-monty)) is "a minimal, secure Python interpreter written in Rust, for running code written by AI agents."
  - Default is "zero access: no filesystem, no network, no environment variables, strict resource limits." Capabilities are added as host functions.
  - Startup latency quoted by Pydantic: Monty 0.004 ms, Docker 195 ms, sandbox services about 1000 ms or more, Pyodide 2800 ms.
  - Snapshotting: execution state can be serialized mid-flight; a snapshot is "single-digit kilobytes."
  - REPL support, because "LLMs strongly assume a REPL."
  - Explicitly framed as Cloudflare-style code mode. Integrated into Pydantic AI via `CodeExecutionToolset`.

### 7e. Vercel d0 (file-system agent, not code mode)

Sources: [We removed 80% of our agent's tools](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools), [Build knowledge agents without embeddings](https://vercel.com/blog/build-knowledge-agents-without-embeddings).
- d0 is a text-to-SQL agent. The old version had 17 specialized tools. The new version has bash in a Vercel Sandbox over semantic-layer files, plus `ExecuteSQL`.
- Benchmark over 5 representative queries: 274.8 s to 77.4 s (3.5x faster); success 4/5 to 5/5; about 102k to 61k tokens (37% fewer); about 12 to 7 steps.
- Caveat from Vercel: "This only worked because our semantic layer was already good documentation."
- On embeddings: "The embedding stack works for semantic similarity, but it falls short when you need a specific value from structured data. The failure mode is silent."
- Five queries is a very small sample.

### 7f. Manus (context engineering, not confirmed code mode)

Source: [Manus blog, 2025-07-18, Yichao 'Peak' Ji](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).
- Treats "the file system as the ultimate context." Compression is "restorable": drop a document's content but keep its path.
- Masks token logits to restrict tools instead of removing tool definitions, to protect the KV cache.
- Average input-to-output token ratio is "around 100:1."
- The post does not mention CodeAct or code-mode tool calling. Whether Manus uses code actions is **unverified** from this source.

---

## 8. Benchmarks comparing RAG, agentic search, and code execution

| Study | Corpus | Arms | Result | Caveats |
|---|---|---|---|---|
| [BrowseComp-Plus](https://arxiv.org/abs/2508.06600) (Chen et al., 2025) | Fixed curated web corpus with verified evidence and hard negatives | Deep-research agents with BM25 vs Qwen3-Embedding-8B | Search-R1 + BM25: 3.86%. GPT-5: 55.9%. GPT-5 + Qwen3-Embedding-8B: 70.1% "with fewer search calls" | The abstract implies 55.9% uses BM25. Retriever choice changes accuracy by 14 points for the same model |
| [Recursive Language Models](https://arxiv.org/html/2512.24601v3) (Zhang, Kraska, Khattab) | BrowseComp-Plus with 1,000 docs in context, 6M to 11M tokens, 150 sampled queries | GPT-5 base, CodeAct + BM25, compaction, OpenCode, RLM; Claude Code with Opus 4.1 | GPT-5 base 0.0 (context limit). CodeAct + BM25 51.0. Compaction 70.5. OpenCode with corpus offloaded to a file 94.0. RLM depth 0: 88.0; depth 1: 91.3; depth 2 and 3: 92.0. Claude Code + offloading 84.0 | Costs: RLM depth 1 about $0.99 per query; Claude Code about $2.03. OpenCode cost not reported. Asterisks mark runs that hit context limits |
| [LlamaIndex fs-explorer](https://www.llamaindex.ai/blog/did-filesystem-tools-kill-vector-search) | 5 arXiv papers (22 to 52 pages), 5 questions; scaling runs on 100 and 1,000 abstracts | Filesystem agent (Gemini 3 Flash; read, grep, glob, parse) vs hybrid RAG (Qdrant, dense + sparse) | Small set: agent correctness 8.4 vs 6.4, relevance 9.6 vs 8.0, but 11.17 s vs 7.36 s. At 1,000 abstracts: RAG 3.34 s and correctness 10; agent 26.96 s and 9.2 | Five questions. LLM-judged scores. Agent latency grows with corpus size |
| [Letta LoCoMo](https://www.letta.com/blog/benchmarking-ai-agent-memory/) | LoCoMo conversations placed in a file | Agent with `grep`, semantic `search_files`, open, close (GPT-4o mini) | 74.0% vs Mem0's reported 68.5% | The "filesystem" agent also had vector search. It is hybrid, not grep-only |
| [Cursor semsearch](https://cursor.com/blog/semsearch) | Cursor Context Bench, plus live A/B | Grep-only vs grep + semantic search | +12.5% average accuracy (6.5% to 23.5%) | Vendor-run, internal benchmark |
| [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) | Internal evals | Direct tool calls vs PTC | Tokens 43,588 to 27,297. Knowledge retrieval 25.6% to 28.5% | Vendor-run, internal benchmark |
| [CodeAct](https://arxiv.org/abs/2402.01030) | API-Bank, M3ToolEval (82 tasks) | JSON vs text vs code actions | Up to +20% success, up to 30% fewer actions | Tool-use tasks, not retrieval over a corpus |
| [Vercel d0](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) | Semantic-layer YAML plus warehouse | 17 custom tools vs bash + SQL | 3.5x faster, 37% fewer tokens, 80% to 100% success | 5 queries |
| [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) (2024-09-19) | Mixed knowledge bases | Embeddings vs + BM25 vs + reranking | Failed retrievals cut 35% (contextual embeddings), 49% (+ contextual BM25), 67% (+ reranking) | Classic RAG study. Shows BM25 catches exact identifiers such as "Error code TS-999" |

What the benchmarks say together:
- No study I found tests all three arms on the same corpus at 20M+ documents. The largest controlled comparison is the RLM paper's 1,000-document, 11M-token setting.
- Offloading the corpus to an environment and letting the model navigate it (file + grep, or REPL + code) beats both stuffing context and a single BM25 tool in the RLM setting.
- Retriever quality still matters when search is the bottleneck. BrowseComp-Plus shows a 14-point swing from BM25 to a dense retriever.
- Filesystem agents get slower as corpora grow. LlamaIndex shows agent latency rising from 9.07 s to 26.96 s between 100 and 1,000 abstracts while RAG stays near 3.3 s.

---

## 9. Comparison table

| Implementation | Model writes | Runs where | Isolation / network | What returns to the model | Tool discovery | State between calls | Measured numbers |
|---|---|---|---|---|---|---|---|
| [Cloudflare Code Mode (Agents SDK)](https://blog.cloudflare.com/code-mode/) | TypeScript against an API generated from MCP schemas | Dynamic Worker V8 isolate via Worker Loader | No internet; `fetch`/`connect` throw; only MCP bindings; keys hidden | `console.log` output | Entire API upfront | None; new isolate per snippet | None published |
| [Cloudflare Code Mode MCP server](https://blog.cloudflare.com/code-mode-mcp/) | JS for `search()` over the OpenAPI spec and `execute()` | Dynamic Worker isolate | No filesystem, no env vars, external fetch off by default | Not stated (**unverified**) | Search by writing code over the spec | Not stated | 2,500+ endpoints in about 1,000 tokens vs 1.17M; 99.9% |
| [Anthropic code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | TypeScript importing per-tool files | Unspecified "secure execution environment" | Left to implementer | Only what is logged or returned; optional PII tokenization | Filesystem browsing or `search_tools` with detail levels | Files and saved skills | 150,000 to 2,000 tokens (98.7%), illustrative |
| [Anthropic PTC](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) | Python | Anthropic code execution container | Sandboxed container; network **unverified** | `stdout` of the script | All opted-in tools, or Tool Search Tool (regex, BM25, custom) | Reusable container by ID; 30-day expiry; checkpoint after about 5 min idle | Tokens down 37%; knowledge retrieval 25.6% to 28.5%; GIA 46.5% to 51.2% ([source](https://www.anthropic.com/engineering/advanced-tool-use)) |
| [OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling) | JavaScript | Fresh isolated V8 runtime, OpenAI-hosted | No network, filesystem, subprocess, console, or Node | `text(...)`/`image(...)` as `program_output` | Top-level tool search; deferred tools loaded before the program | None between programs | None published |
| [OpenAI Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter) | Python | Container, "fully sandboxed virtual machine" | Network **unverified** | Output items and file citations | N/A (no tool calls from code) | Container lives until 20 min idle | Memory tiers 1g to 64g |
| [Codex CLI](https://openai.com/index/inside-the-codex-sandbox/) | Shell commands, `rg` preferred | User's machine under Seatbelt, bubblewrap + seccomp, or Windows sandbox | Network off by default; optional domain proxy | Full command output and exit code | Fixed tools | Filesystem | None for search |
| [Claude Code](https://code.claude.com/docs/en/tools-reference) | Shell (`find`/`grep` via bfs/ugrep), or Grep/Glob/Read | User's machine | Permission rules and optional sandbox | Full tool output (Glob capped at 100) | Fixed tools; MCP tool search | Filesystem | Qualitative; 84.0 on BrowseComp-Plus 1K with offloading ([RLM](https://arxiv.org/html/2512.24601v3)) |
| [Cursor agent](https://cursor.com/blog/semsearch) | Tool calls: grep plus semantic search | User's machine plus Cursor index | N/A | Tool output | Fixed tools | Index | +12.5% accuracy with semantic search; rg over 15 s on big monorepos ([regex post](https://cursor.com/blog/fast-regex-search)) |
| [CodeAct](https://arxiv.org/abs/2402.01030) | Python | Python interpreter | Not the focus | Execution results as observations | Tools in prompt | Multi-turn interpreter | Up to +20% success, up to 30% fewer actions |
| [smolagents CodeAgent](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution) | Python | Restricted local interpreter, or E2B, Modal, Docker, Blaxel | Import allowlist; op-count cap | "Only the output" | Tools in prompt (**unverified** detail) | Remote: state sent per `agent.run()`; local **unverified** | None in docs |
| [goose Code Mode](https://goose-docs.ai/blog/2025/12/15/code-mode-mcp) | JS/TS | Boa JS engine | Not stated | Chained results stay out of context | Search modules, read tool source | Not stated | None |
| [Executor](https://executor.sh/docs/mcp) | JavaScript | Sandboxed interpreter | No fetch, fs, process, timers, imports; "cooperative" limits | Program return value | `skills`, `tools.search`, `describe` | Pause/resume for approvals | Limits: 64K chars, 100 calls, 5 min |
| [UTCP code-mode](https://github.com/universal-tool-calling-protocol/code-mode) | TypeScript | Node.js VM (isolated-vm in commits) | Not stated | `{result, logs}` | `searchTools`, `__interfaces` | Not stated | 67% to 88% faster per third-party benchmark (**unverified**) |
| [Pydantic Monty](https://pydantic.dev/articles/pydantic-monty) | Python subset | Rust interpreter in-process | Zero access by default; host functions only | Program result and output | Host-defined functions | Snapshots (single-digit KB); REPL | Startup 0.004 ms vs Docker 195 ms |
| [Recursive Language Models](https://arxiv.org/html/2512.24601v3) | Python over a `context` variable, with `llm_query` sub-calls | Python REPL | Not the focus | Truncated `print` output | Prompt describes the REPL | REPL variables persist | 91.3 on BrowseComp-Plus 1K (GPT-5, depth 1) |
| [Vercel d0](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) | Bash plus SQL | Vercel Sandbox | Sandbox | Command output | Browse files | Sandbox filesystem | 3.5x faster, 37% fewer tokens, 5 queries |

---

## 10. Analysis: when each approach wins

This section is my synthesis of the sources above. It is not a quote from any vendor.

### When classic RAG wins
- **Latency-bound, single-hop semantic questions over large corpora.** LlamaIndex's RAG stayed near 3.3 s from 100 to 1,000 documents while the filesystem agent went from 9 s to 27 s ([LlamaIndex](https://www.llamaindex.ai/blog/did-filesystem-tools-kill-vector-search)).
- **Paraphrase and concept queries where the user does not know the words in the document.** Dense retrieval beat BM25 by 14 points for GPT-5 on BrowseComp-Plus ([BrowseComp-Plus](https://arxiv.org/abs/2508.06600)). Cursor measured gains from embeddings on top of grep ([Cursor](https://cursor.com/blog/semsearch)).
- **When a deterministic, auditable first stage is required.** A fixed retriever gives the same candidates every time. An agent loop does not.
- RAG loses on exact values. Embeddings can miss "TS-999" ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)) and fail silently on specific values ([Vercel](https://vercel.com/blog/build-knowledge-agents-without-embeddings)). RAG also cannot count or aggregate.

### When agentic grep search wins
- **Exact strings and identifiers in a corpus that fits a fast scan.** This covers code, logs, configs, and moderate document sets.
- **Multi-hop questions where each hit suggests the next query.** OpenAI's docs route "adaptive search" to direct tool calls for this reason ([OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).
- **Fresh, frequently changing data and no budget to run an index.** This is the core of Anthropic's reasoning for Claude Code ([Latent Space](https://latent.space/p/claude-code/)).
- It loses on latency at scale: Cursor sees ripgrep calls over 15 s and built an index to fix it ([Cursor](https://cursor.com/blog/fast-regex-search)). It loses on paraphrase. It burns tokens because every hit enters context.

### When code mode wins
- **Aggregation, joins, filtering, dedup, and counting over many records.** The PTC example reduced 200KB of rows to 1KB of results ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use)).
- **Fan-out over many items.** Parallel calls in one program avoid one inference pass per call.
- **Many tools or a huge API surface.** About 1,000 tokens for 2,500+ endpoints ([Cloudflare](https://blog.cloudflare.com/code-mode-mcp/)).
- **Data the model should not see in full.** Sensitive values can flow between tools without entering context ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)).
- **Corpora far larger than context.** RLMs at 6M to 11M tokens ([RLM](https://arxiv.org/html/2512.24601v3)).
- It loses when every intermediate result needs model judgment, and when native citations must be preserved. OpenAI says to keep final citation validation in direct tool calls unless the program preserves and validates every item ([OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)). It also adds a sandbox to build and secure ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp); [Pydantic mcp-run-python](https://github.com/pydantic/mcp-run-python)).

### The pattern that combines them
The strongest systems in the evidence layer these. Cursor uses grep plus embeddings plus a regex index. Anthropic pairs tool search with PTC. OpenAI's docs prescribe code for bounded data stages and direct calls for judgment and citations. Separate "how candidates are found" (index) from "who drives the loop" (agent) from "where bulk data is processed" (sandboxed code).

---

## 11. What this means for 20M to 30M investigation files

This section is design analysis, not a sourced claim. Where it leans on a source, the source is linked.

### Short answer to the interview question
"Besides embeddings and full-text search, what search strategies do you know for 1M documents?" Defensible answers grounded in this survey:
1. **Agentic iterative search.** The model reformulates queries over several rounds and reads results ([Claude Code](https://latent.space/p/claude-code/), [Codex](https://openai.com/index/inside-the-codex-sandbox/)).
2. **Indexed regex and exact-identifier search.** Use an n-gram or trigram inverted index so grep-shaped queries stay fast at scale ([Cursor fast regex](https://cursor.com/blog/fast-regex-search)).
3. **Structured metadata queries.** Use SQL or filters over extracted fields, written by the model ([Vercel d0](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools)).
4. **Code mode over a typed corpus API.** The model writes a program that searches, filters, aggregates, and prints only results ([Anthropic PTC](https://www.anthropic.com/engineering/advanced-tool-use), [OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).
5. **Recursive decomposition.** Code splits the corpus and calls sub-LLMs on shards, map-reduce style ([RLM](https://arxiv.org/html/2512.24601v3)).
6. **Hybrid lexical plus dense retrieval with reranking** as a first stage ([Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)).
7. **Progressive disclosure of tools and schemas,** so the agent can use many specialized search APIs without paying for all of them in context ([Anthropic tool search](https://www.anthropic.com/engineering/advanced-tool-use)).

Entity resolution, link analysis, and graph queries are also standard in investigations. I did not research them here, so they are listed without a source.

### Exact identifiers (phone numbers, case numbers, IMEIs, plates)
- Raw grep over 30M files per query is too slow. Cursor already sees 15 s ripgrep calls on single monorepos ([Cursor](https://cursor.com/blog/fast-regex-search)). Claude Code's "no index" stance does not transfer to this scale.
- Embeddings are the wrong tool for exact values ([Anthropic](https://www.anthropic.com/news/contextual-retrieval), [Vercel](https://vercel.com/blog/build-knowledge-agents-without-embeddings)).
- Recommended design: normalize identifiers at ingest (for example one canonical phone format) and store them in an inverted index and a structured entity table. Expose a grep-shaped tool to the agent that the harness answers from the index. The agent keeps the grep loop that models are good at. The index removes the linear scan.

### Aggregation over metadata ("how many calls between these numbers in March, by tower")
- This is code mode's home ground. RAG cannot count. Agentic grep would pull every row into context.
- Recommended design: a typed corpus API (`search`, `filter`, `count`, `facets`, `get_document`) exposed to a sandboxed program. The program aggregates and prints a small table. Declare output schemas so generated code is reliable ([OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).
- Run the sandbox with no network and no filesystem, and route all access through the corpus API. Cloudflare bindings and OpenAI's V8 runtime are the reference designs ([Cloudflare](https://blog.cloudflare.com/code-mode/), [OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).

### Chain-of-custody citations
- Code mode hides intermediate data from the model by design. That is good for context and privacy. It is a risk for provenance.
- OpenAI's own guidance is to keep final citation validation out of programs unless the program preserves native output and validates every item ([OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).
- Recommended design: every API result carries a document ID, a content hash, and a page or byte span. Programs must print citations, not just conclusions. A final direct-tool verification step re-reads each cited span before the answer is shown. Log every program and every tool call it made for audit.
- Anthropic's PII tokenization pattern also fits here. Sensitive fields can move between tools as placeholders and never enter the model context ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)).

### Semantic questions ("messages that discuss a payment without saying money")
- Keep a dense or hybrid retriever as one tool among several. Do not make it the only path. The BrowseComp-Plus and Cursor results both show the agent does better when a good semantic retriever is available ([BrowseComp-Plus](https://arxiv.org/abs/2508.06600), [Cursor](https://cursor.com/blog/semsearch)).

### Implications for the demo
- Hold the corpus API constant across arms. Vary only the harness: RAG pipeline, agentic tool loop, code mode.
- Use task categories that separate the arms: exact-ID lookup, aggregation, semantic paraphrase, multi-hop, and citation-required answers.
- Measure correctness, citation precision and recall, tokens, latency, and tool calls. OpenAI's PTC docs list the same metrics ([OpenAI PTC](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)).
- Report sample sizes. Several vendor results here rest on 5 queries (Vercel, LlamaIndex) or on "mostly vibes" (Claude Code).

---

## 12. Unverified items and gaps

- Boris Cherny's X post about "RAG + a local vector db" (page failed to load; seen only as a search snippet).
- Whether OpenAI Codex has any index or embedding feature. I found none; absence is not proof.
- Network policy inside Anthropic's code execution container and OpenAI's Code Interpreter container.
- What Cloudflare's server-side Code Mode returns to the model, and the 1.17M vs "over 2 million" token discrepancy on the same page.
- smolagents local executor state persistence between steps.
- UTCP code-mode's cited third-party benchmark numbers.
- Whether Manus uses code actions.
- Publication dates for the Cursor posts, the Vercel posts, and the LlamaIndex post were not on the scraped pages.
- No study found compares RAG, agentic search, and code mode on the same corpus at millions of documents.

## Sources read

- Cloudflare: https://blog.cloudflare.com/code-mode/ ; https://blog.cloudflare.com/code-mode-mcp/
- Anthropic: https://www.anthropic.com/engineering/code-execution-with-mcp ; https://www.anthropic.com/engineering/advanced-tool-use ; https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling ; https://www.anthropic.com/news/contextual-retrieval ; https://code.claude.com/docs/en/tools-reference
- Claude Code statements: https://news.ycombinator.com/item?id=43163011 ; https://latent.space/p/claude-code/ ; https://every.to/podcast/transcript-how-to-use-claude-code-like-the-people-who-built-it ; https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny
- Cursor: https://cursor.com/blog/semsearch ; https://cursor.com/blog/fast-regex-search
- OpenAI: https://openai.com/index/inside-the-codex-sandbox/ ; https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md ; https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide ; https://developers.openai.com/api/docs/guides/tools-code-interpreter ; https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling
- CodeAct and smolagents: https://arxiv.org/abs/2402.01030 ; https://arxiv.org/html/2402.01030v4 ; https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents ; https://huggingface.co/docs/smolagents/tutorials/secure_code_execution
- Others: https://goose-docs.ai/blog/2025/12/15/code-mode-mcp ; https://github.com/UsefulSoftwareCo/executor ; https://executor.sh/docs/mcp ; https://github.com/universal-tool-calling-protocol/code-mode ; https://github.com/pydantic/mcp-run-python ; https://pydantic.dev/articles/pydantic-monty ; https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools ; https://vercel.com/blog/build-knowledge-agents-without-embeddings ; https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Benchmarks: https://arxiv.org/abs/2508.06600 ; https://arxiv.org/html/2512.24601v3 ; https://www.llamaindex.ai/blog/did-filesystem-tools-kill-vector-search ; https://www.letta.com/blog/benchmarking-ai-agent-memory/

---

## 13. Errata after hands-on testing (2026-11-22)

The hands-on comparison in [code-mode-comparison.md](code-mode-comparison.md) ran the implementations above against one probe suite and read their source. It corrects these points in this survey:

- **Cursor.** Cursor's current search docs say agent search uses Instant Grep, a local regex index, and that Cursor "does not store embeddings of your codebase for search". The +12.5% semantic-search result in section 4a describes the November 2025 design.
- **Claude Code.** It now has an experimental, off-by-default Code Mode in which "Claude writes a piece of JavaScript that makes the tool calls". The "fixed tools" row in section 9 is out of date.
- **Codex CLI.** It ships a code mode (a V8 `codex-code-mode-host`) behind a feature flag. That runtime overwrites any heap limit with none.
- **UTCP code-mode.** The engine is isolated-vm, not Node's `vm`. The cited third-party benchmark runs RestrictedPython, never UTCP code mode, and its numbers do not match the README's.
- **Pydantic Monty.** Version 1.6 runs each sandbox in a subprocess with a cleared environment, and the library sets no default time or memory limit.
- **Cloudflare.** The code-mode MCP server registers five tools, not two. It returns only the program's return value, cut at about 24,000 characters. The Agents SDK's 60-second timeout is a `Promise.race` inside the isolate, which a synchronous loop never yields to.
- **Anthropic programmatic tool calling.** It now needs `code_execution_20260120` or later. Its docs list zero data retention and HIPAA as not eligible, with data retained up to 30 days.
- **Network inside hosted containers.** Anthropic's code execution container has internet access "completely disabled". OpenAI's hosted containers have no outbound network by default; admins can allowlist domains.
