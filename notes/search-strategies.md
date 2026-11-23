# Search beyond embeddings and full-text search

The question from a recent interview: "Besides embedding and maybe full-text search, what search strategies could help? Say you have a corpus of 1 million documents and you need to find something."

## The answer in one breath

Pick the strategy by the shape of the question, not by the corpus. Exact identifiers want a normalized exact index. Questions about who, when and how many want structured queries over metadata, ideally written by the agent as code. Fuzzy "find the email where" questions want hybrid ranking with a reranker. In my benchmark, agents that could combine search, grep and metadata queries answered 92 to 100% of 50 questions, while retrieval-only RAG answered 34%.

## The strategies

| Strategy | What it is good at | What it misses | Investigation example |
|---|---|---|---|
| Exact match on normalized identifiers | Phone numbers, case numbers, IMEIs, plates, account numbers in any formatting | Anything fuzzy | "Every file that mentions 773-555-0142", written as 773.555.0142 or (773) 555 0142 |
| Regex or trigram index (grep, Zoekt-style) | Patterns and partial identifiers; no ingest step for grep | Slow without an index at 20M+ files; no ranking | "Any number starting 773-555" |
| BM25 / full-text | Rare words, names, jargon | Paraphrase, synonyms | "Raptor", "Cowlitz" |
| Dense embeddings | Paraphrase, vague recollection | Exact strings, numbers, negation | "The email where someone worried the deal was illegal" |
| Hybrid with reciprocal rank fusion | Both of the above without tuning score scales | Still one shot | Default first-stage ranker |
| Learned sparse (SPLADE) and late interaction (ColBERT) | Better first-stage quality than BM25 or single-vector dense | Index size and serving cost | Worth testing once hybrid plateaus |
| Cross-encoder reranking | Top-1 precision | Adds a model call per query | Voice or single-answer surfaces |
| Metadata filters and SQL | Who, when, how many, joins across sources | Text meaning | "Who did the suspect call most in the 48 hours before each arrest" |
| Entity extraction and a link graph | Relationships across files: who knows whom, shared numbers, co-occurrence | Errors in extraction propagate | Call-graph and email-graph link analysis |
| Agentic search (tool loop) | Multi-step questions; refines queries from what it finds | Latency, cost, and many round trips on aggregation | Claude Code's grep/glob/read loop |
| Code mode (agent writes a program against a typed API in a sandbox) | Aggregation, joins and filtering in one call; only the result enters context | Needs a well-designed API and a sandbox | Cloudflare Code Mode, Anthropic programmatic tool calling |
| Recursive / long-context processing | Reading everything when the corpus fits | Cost grows with corpus size | Recursive Language Models on BrowseComp-Plus |
| Hierarchical summaries (RAPTOR-style), clustering, near-duplicate detection | Orientation in a huge case; collapsing copies | Summaries can drop the needle | First pass on a new 20M-file case |

## What I would build at 20 to 30 million files

1. Ingest once: parse every file to typed records with a stable id, a content hash and page or row spans. Normalize identifiers into their own columns. Deduplicate by hash.
2. Index three ways: an exact-identifier index, a full-text index, and a vector index (HNSW with per-case filtering). Keep entity links as tables.
3. Give the agent a typed API over those indexes and let it write code against it in a sandbox, as in this repo's `codemode` strategy. Code does the filtering, counting and joining; only the answer and its citations come back.
4. Verify citations outside the model: re-read every cited span and recompute every number from the cited rows before showing the answer. My take-home did this for spreadsheets.
5. Measure all of it against a graded question set with exact ground truth for counts and identifiers, as this benchmark does.
