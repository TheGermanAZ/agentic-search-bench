# agentic-search-bench

Four ways for an agent to search a case file, measured on the same corpus and the same graded questions:

| Strategy | What the model gets |
|---|---|
| `rag` | Hybrid retrieval (BM25 + embeddings, reciprocal rank fusion), top 8 chunks pasted into one prompt. No tools. |
| `agentic` | Claude Code's own Grep, Glob and Read tools over one text file per message. No index. |
| `tools` | A typed corpus API as six tools: `search`, `grep`, `messages`, `count`, `people`, `read`. |
| `codemode` | The same API as a JavaScript object in a QuickJS sandbox, behind one `execute` tool. Only what the program prints comes back. |

`tools` and `codemode` expose the same six functions, and what reaches the model is capped at 8,000 characters per call in both. The difference is that a program can process up to 5,000 records inside the sandbox and print only a summary, while a tool call has to return its rows to the model. That difference is the claim code mode makes, and it is what this benchmark measures. The typed tools have no pagination, which a stronger tool design would add.

The corpus is the public Enron email corpus: 517,401 files, deduplicated to 255,154 unique messages and 412,117 chunks. It is a real fraud-investigation evidence set released by FERC, which makes it a fair stand-in for an investigator's case file.

Results are in [RESULTS.md](RESULTS.md). 85 code-mode implementations were compared and 69 tested hands-on with one probe suite (network, files, secrets, escapes, time and memory limits, parallel tool calls), each with its defaults and its strictest settings, in [research/code-mode-comparison.md](research/code-mode-comparison.md). The probe spec is [research/probes/SPEC.md](research/probes/SPEC.md), the gates and ranking rules are [research/probes/RUBRIC.md](research/probes/RUBRIC.md), independent shared-server checks of the 13 strongest are [research/probes/verify/REPORT.md](research/probes/verify/REPORT.md), and each implementation's harness is under `research/probes/<impl>/`. Short answer: Vercel AI SDK Code Mode for TypeScript, Pydantic AI Harness CodeMode or FastMCP CodeMode for Python. The earlier docs-based survey is [research/code-mode-survey.md](research/code-mode-survey.md), with errata at the end. A short answer to "what search strategies exist beyond embeddings and full-text search" is in [notes/search-strategies.md](notes/search-strategies.md).

## Questions

50 questions in [evals/questions.json](evals/questions.json), in four groups:

- **Aggregation (15).** Counts, top recipients, top senders before a date, busiest day. Truth comes from SQL over the deduplicated messages, so it is exact.
- **Identifiers (10).** A phone number or reference code that appears in exactly one message, under any common formatting. The question writes phone numbers with dashes; the message may use dots or spaces.
- **Find the email (15).** An LLM wrote a paraphrased question from a seed email. The gold set is the seed, plus every other cited message that an LLM judge says states the answering fact (pooled judging, applied to every strategy the same way). Strict scores against the seed alone are reported too.
- **Hard (10).** Aggregation over messages selected by text ("how many distinct senders mentioned LJM in November 2001") and two-hop questions. Truth comes from ripgrep over the same files the agents search, joined with metadata in SQL.

## Run it

Needs Node 24 or later, [pnpm](https://pnpm.io), [uv](https://docs.astral.sh/uv/), ripgrep, and a logged-in Claude Code (the Agent SDK uses its credentials). Embedding the corpus uses the Mac GPU through PyTorch MPS. The repo ran on Bun until November 2026; it moved to Node so V8-based sandboxes such as isolated-vm can load.

```bash
pnpm install
curl -LO https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz   # 423 MB
mkdir -p data/raw && tar xzf enron_mail_20150507.tar.gz -C data/raw
pnpm ingest               # about 2 minutes: dedupe, one file per message, SQLite + FTS5
pnpm embed                # bge-small-en-v1.5 on the GPU, about 25 minutes
pnpm check-vectors        # proves stored vectors equal runtime query vectors
pnpm build-evals && pnpm exec tsx src/build-hard.ts
pnpm bench --run=main --model=claude-sonnet-5-5 --concurrency=4
pnpm judge --run=main && pnpm rescore --run=main
pnpm ask --strategy=codemode --engine=isolated-vm "Who did vince.kaminski@enron.com email most in April 2001?"
```

The benchmark resumes: rerunning a `bench` command skips finished cells. `--engine=` picks the code-mode sandbox (below); Python engines also need `uv sync --project py`.

## Layout

- `src/ingest.ts` parses the maildir, dedupes by (sender, date, subject, body), writes one file per message and the SQLite index.
- `src/search.ts` is the corpus API: hybrid search, ripgrep, metadata queries, counts, people lookup.
- `src/engines/` holds the code-mode sandboxes behind one interface: `quickjs-asyncify` (the original), `vercel-run`, `quickjs-ng`, `isolated-vm`, and the Python engines `py-monty`, `py-fastmcp`, `py-pydantic-ai` (a Python sidecar in `py/`). All share one host contract in `src/engines/host.ts`: only the six corpus functions, 60 s of guest CPU, a 65 s wall clock including corpus calls, 512 MB per execution, an 8,000-character output cap, 8 concurrent executions, scrubbed host errors. They are compared in [research/probes/engines/COMPARISON.md](research/probes/engines/COMPARISON.md).
- `src/db.ts` wraps Node's built-in `node:sqlite` (FTS5 included).
- `src/strategies.ts` defines the four strategies on the Claude Agent SDK, with user settings, plugins and MCP config isolated.
- `src/bench.ts`, `src/judge.ts`, `src/rescore.ts`, `src/score.ts` run, judge and score.
