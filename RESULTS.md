# Results

Scores come from `runs/main` (50 questions, one trial per question, strategy and model) and `runs/latency` (8 questions, one at a time). Regenerate with `bun run judge -- --run=main --run=latency`, `bun run rescore -- --run=main` and `bun run src/site.ts`.

## Findings

- **Retrieval-only RAG cannot count.** Top-8 hybrid RAG answered 2 of 15 aggregation questions and 0 of 10 hard ones on both models. It did reasonably on "find the email" (11 of 15 on both models) in one call with the fewest tokens. It is the right first stage of a search system, not the whole system.
- **Identifiers need exact search and normalization.** Every agent strategy found all 10 identifiers. RAG found 4. The questions write phone numbers with dashes and several messages use dots, which neither BM25 tokens nor embeddings bridge. Grep with a pattern like `703[-. ]227[-. ]8777` does.
- **Code mode and typed tools tie on accuracy and split on cost.** Both use the same API and both answered 49 or 50 of 50. On the questions that need counting, code mode used far less context: on Sonnet's hard tier, 6,258 input tokens per question against 29,154 for typed tools. On Haiku's aggregation questions it made 1 call where typed tools made 10 (median), with 7,012 tokens against 38,827. The program does the counting, so raw rows never enter the model's context.
- **Code mode does not help when the model must read.** On "find the email" questions, code mode used more tokens than typed tools (19,200 against 15,290 on Sonnet), even though its programs returned fewer characters (5,875 against 9,437). It took a second program more often (median 2 calls against 1), and every extra turn re-sends the whole context. This matches OpenAI's guidance to keep judgment and citation steps as direct calls and use code for bulk data stages.
- **Agentic grep gets there, expensively.** With no index, Claude Code's own tools reached 48 of 50 on Sonnet and 46 of 50 on Haiku, but used 75,374 input tokens per question on Sonnet (8 times code mode) and 168,836 on Haiku (13 times). Every grep rescans 1.2 GB of files. That scan grows with the corpus, which is why Cursor built an index for regex search; at 20 to 30 million files I expect it to dominate (an estimate, not measured here).
- **The gaps hold on a smaller model.** Haiku with code mode answered 50 of 50 for about a tenth of a cent per question. The weaker model widens the cost gap between strategies more than the accuracy gap.
- **Latency follows the index.** In a separate run on a quiet machine, one question at a time (8 questions on Sonnet), median latency was 5.4 seconds for RAG, 7.3 for code mode, 8.8 for typed tools and 29.4 for agentic grep. From `src/timings.ts` (median of 5 runs, `runs/timings.txt`): one ripgrep pass over the corpus takes 3.5 to 4.7 seconds, an indexed count takes 9 milliseconds, and a hybrid search takes 0.7 to 1.2 seconds. The machine was not fully idle (load average about 26), so absolute times are rough. Agentic grep pays a full scan on every search, so its latency grows with the corpus. These latency figures come from 8 questions, one trial each, so read them as rough.

## Limits

- One trial per question, strategy and model. Wilson intervals are over these 50 questions and do not capture run-to-run variance.
- Scoring: counts, dates and addresses must match exactly; identifier questions need the right message cited and the right sender; "find the email" questions need a relevant citation and an answer an LLM judge accepts. Citations are not checked on count and date questions.
- Relevance judgments: Sonnet and Opus judges agreed on 29 of 30 pooled citations (`evals/judgments.json`, `evals/judgments-second.json`). Answer judgments: `evals/answer-judgments.json`.
- The hard tier was added after the first 40 questions saturated and was designed to need counting over text matches. Treat it as exploratory, not held out.
- RAG is one configuration: top 8 chunks, at most 4 chunks per message, one call, no SQL step.
- Typed tools cap each call's output at 8,000 characters with no pagination. Code mode has the same cap on what it prints but can process up to 5,000 records inside the sandbox.
- After the runs, a review found that filtered keyword search filtered after taking the global top results. That could only have hurt typed tools and code mode. It is fixed in `src/search.ts`; the published runs used the old version.
- The code-mode sandbox changed after the runs: the hands-on sandbox probes found that all executions shared one asyncify module (unsafe under concurrency) and that a dynamic `import()` crashed the host. It now builds a fresh module per execution and refuses imports. A second round found that the advertised 512 MB memory cap never applied: QuickJS's `setMemoryLimit` is inert in quickjs-emscripten 0.32 (its allocation counter read about 53 KB after 50 MB of strings), and a memory bomb reached 3.08 GB of host memory. Each execution now gets its own WebAssembly memory with a 512 MB maximum, and the compiled module is shared, which cut startup from about 9 ms to 1.4 ms. The same bomb now stops at 576 MB of host memory; separately, the host pays a one-time ~1.1 GB for the engine's JIT once QuickJS runs hot. Normal programs behave the same, and live checks after both changes answered correctly; the published runs used the original version. Later the same month the repo moved from Bun to Node 24 and pnpm, the sandbox became one of seven interchangeable engines (`src/engines/`), and `grep` changed from a blocking ripgrep call to an async one that runs one scan at a time and shares identical concurrent scans. The blocking call had let one program that fired 31 greps at once freeze the host for about 109 s. Grep results are identical; the published runs used the blocking version.
- The agentic strategy is now confined to the corpus folder by a permission callback. The published runs predate it; a scan of every agentic trace found no reads outside the corpus except the SDK's own saved tool output.

## Main run

### Scored against seed gold plus pooled judgments

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | aggregate | agentic | 13/15 (87%) | 62% to 96% | 123.3s | 19 | 102,686 | 26,610 | $0.012 |
| claude-haiku-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 14.3s | 1 | 7,012 | 877 | $0.001 |
| claude-haiku-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 16.5s | 0 | 3,883 | 0 | $0.002 |
| claude-haiku-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 38.3s | 10 | 38,827 | 13,391 | $0.004 |
| claude-haiku-5-5 | all | agentic | 46/50 (92%) | 81% to 97% | 109.1s | 13 | 168,836 | 27,084 | $0.011 |
| claude-haiku-5-5 | all | codemode | 50/50 (100%) | 93% to 100% | 67.2s | 2 | 12,849 | 4,773 | $0.001 |
| claude-haiku-5-5 | all | rag | 17/50 (34%) | 22% to 48% | 38.1s | 0 | 3,609 | 0 | $0.001 |
| claude-haiku-5-5 | all | tools | 50/50 (100%) | 93% to 100% | 99.1s | 3 | 26,034 | 13,643 | $0.003 |
| claude-haiku-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 113.7s | 25 | 134,234 | 24,589 | $0.010 |
| claude-haiku-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 83.4s | 2 | 9,652 | 1,292 | $0.001 |
| claude-haiku-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 23.3s | 0 | 3,389 | 0 | $0.002 |
| claude-haiku-5-5 | hard | tools | 10/10 (100%) | 72% to 100% | 208.4s | 5 | 34,443 | 23,190 | $0.005 |
| claude-haiku-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 61.6s | 2 | 133,980 | 2,727 | $0.008 |
| claude-haiku-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 98.8s | 1 | 5,805 | 385 | $0.001 |
| claude-haiku-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 51.2s | 0 | 3,329 | 0 | $0.001 |
| claude-haiku-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 99.1s | 2 | 6,975 | 1,243 | $0.001 |
| claude-haiku-5-5 | semantic | agentic | 14/15 (93%) | 70% to 99% | 157.6s | 13 | 281,292 | 45,460 | $0.013 |
| claude-haiku-5-5 | semantic | codemode | 15/15 (100%) | 80% to 100% | 126.1s | 2 | 25,513 | 13,915 | $0.003 |
| claude-haiku-5-5 | semantic | rag | 11/15 (73%) | 48% to 89% | 64.0s | 0 | 3,668 | 0 | $0.001 |
| claude-haiku-5-5 | semantic | tools | 15/15 (100%) | 80% to 100% | 147.2s | 2 | 20,342 | 15,796 | $0.003 |
| claude-sonnet-5-5 | aggregate | agentic | 14/15 (93%) | 70% to 99% | 88.4s | 5 | 64,584 | 25,628 | $0.106 |
| claude-sonnet-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 4.7s | 1 | 5,438 | 292 | $0.011 |
| claude-sonnet-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 5.6s | 0 | 3,864 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 8.6s | 2 | 22,357 | 9,889 | $0.041 |
| claude-sonnet-5-5 | all | agentic | 48/50 (96%) | 87% to 99% | 92.0s | 8 | 75,374 | 15,838 | $0.083 |
| claude-sonnet-5-5 | all | codemode | 50/50 (100%) | 93% to 100% | 16.9s | 1 | 9,650 | 1,936 | $0.014 |
| claude-sonnet-5-5 | all | rag | 17/50 (34%) | 22% to 48% | 11.6s | 0 | 3,588 | 0 | $0.018 |
| claude-sonnet-5-5 | all | tools | 49/50 (98%) | 90% to 100% | 15.5s | 2 | 18,330 | 9,312 | $0.034 |
| claude-sonnet-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 157.1s | 13 | 69,637 | 10,312 | $0.091 |
| claude-sonnet-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 129.6s | 1 | 6,258 | 191 | $0.010 |
| claude-sonnet-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 49.9s | 0 | 3,368 | 0 | $0.018 |
| claude-sonnet-5-5 | hard | tools | 9/10 (90%) | 60% to 98% | 225.9s | 3 | 29,154 | 17,221 | $0.058 |
| claude-sonnet-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 28.1s | 2 | 19,845 | 1,663 | $0.020 |
| claude-sonnet-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 18.0s | 1 | 5,035 | 239 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 13.3s | 0 | 3,307 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 17.4s | 1 | 6,026 | 351 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 15/15 (100%) | 80% to 100% | 81.1s | 10 | 127,008 | 19,181 | $0.097 |
| claude-sonnet-5-5 | semantic | codemode | 15/15 (100%) | 80% to 100% | 17.4s | 2 | 19,200 | 5,875 | $0.026 |
| claude-sonnet-5-5 | semantic | rag | 11/15 (73%) | 48% to 89% | 11.2s | 0 | 3,646 | 0 | $0.018 |
| claude-sonnet-5-5 | semantic | tools | 15/15 (100%) | 80% to 100% | 12.2s | 1 | 15,290 | 9,437 | $0.028 |

### Scored against seed gold only (strict)

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | aggregate | agentic | 13/15 (87%) | 62% to 96% | 123.3s | 19 | 102,686 | 26,610 | $0.012 |
| claude-haiku-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 14.3s | 1 | 7,012 | 877 | $0.001 |
| claude-haiku-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 16.5s | 0 | 3,883 | 0 | $0.002 |
| claude-haiku-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 38.3s | 10 | 38,827 | 13,391 | $0.004 |
| claude-haiku-5-5 | all | agentic | 41/50 (82%) | 69% to 90% | 109.1s | 13 | 168,836 | 27,084 | $0.011 |
| claude-haiku-5-5 | all | codemode | 47/50 (94%) | 84% to 98% | 67.2s | 2 | 12,849 | 4,773 | $0.001 |
| claude-haiku-5-5 | all | rag | 16/50 (32%) | 21% to 46% | 38.1s | 0 | 3,609 | 0 | $0.001 |
| claude-haiku-5-5 | all | tools | 47/50 (94%) | 84% to 98% | 99.1s | 3 | 26,034 | 13,643 | $0.003 |
| claude-haiku-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 113.7s | 25 | 134,234 | 24,589 | $0.010 |
| claude-haiku-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 83.4s | 2 | 9,652 | 1,292 | $0.001 |
| claude-haiku-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 23.3s | 0 | 3,389 | 0 | $0.002 |
| claude-haiku-5-5 | hard | tools | 10/10 (100%) | 72% to 100% | 208.4s | 5 | 34,443 | 23,190 | $0.005 |
| claude-haiku-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 61.6s | 2 | 133,980 | 2,727 | $0.008 |
| claude-haiku-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 98.8s | 1 | 5,805 | 385 | $0.001 |
| claude-haiku-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 51.2s | 0 | 3,329 | 0 | $0.001 |
| claude-haiku-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 99.1s | 2 | 6,975 | 1,243 | $0.001 |
| claude-haiku-5-5 | semantic | agentic | 9/15 (60%) | 36% to 80% | 157.6s | 13 | 281,292 | 45,460 | $0.013 |
| claude-haiku-5-5 | semantic | codemode | 12/15 (80%) | 55% to 93% | 126.1s | 2 | 25,513 | 13,915 | $0.003 |
| claude-haiku-5-5 | semantic | rag | 10/15 (67%) | 42% to 85% | 64.0s | 0 | 3,668 | 0 | $0.001 |
| claude-haiku-5-5 | semantic | tools | 12/15 (80%) | 55% to 93% | 147.2s | 2 | 20,342 | 15,796 | $0.003 |
| claude-sonnet-5-5 | aggregate | agentic | 14/15 (93%) | 70% to 99% | 88.4s | 5 | 64,584 | 25,628 | $0.106 |
| claude-sonnet-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 4.7s | 1 | 5,438 | 292 | $0.011 |
| claude-sonnet-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 5.6s | 0 | 3,864 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 8.6s | 2 | 22,357 | 9,889 | $0.041 |
| claude-sonnet-5-5 | all | agentic | 43/50 (86%) | 74% to 93% | 92.0s | 8 | 75,374 | 15,838 | $0.083 |
| claude-sonnet-5-5 | all | codemode | 48/50 (96%) | 87% to 99% | 16.9s | 1 | 9,650 | 1,936 | $0.014 |
| claude-sonnet-5-5 | all | rag | 16/50 (32%) | 21% to 46% | 11.6s | 0 | 3,588 | 0 | $0.018 |
| claude-sonnet-5-5 | all | tools | 47/50 (94%) | 84% to 98% | 15.5s | 2 | 18,330 | 9,312 | $0.034 |
| claude-sonnet-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 157.1s | 13 | 69,637 | 10,312 | $0.091 |
| claude-sonnet-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 129.6s | 1 | 6,258 | 191 | $0.010 |
| claude-sonnet-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 49.9s | 0 | 3,368 | 0 | $0.018 |
| claude-sonnet-5-5 | hard | tools | 9/10 (90%) | 60% to 98% | 225.9s | 3 | 29,154 | 17,221 | $0.058 |
| claude-sonnet-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 28.1s | 2 | 19,845 | 1,663 | $0.020 |
| claude-sonnet-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 18.0s | 1 | 5,035 | 239 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 13.3s | 0 | 3,307 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 17.4s | 1 | 6,026 | 351 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 10/15 (67%) | 42% to 85% | 81.1s | 10 | 127,008 | 19,181 | $0.097 |
| claude-sonnet-5-5 | semantic | codemode | 13/15 (87%) | 62% to 96% | 17.4s | 2 | 19,200 | 5,875 | $0.026 |
| claude-sonnet-5-5 | semantic | rag | 10/15 (67%) | 42% to 85% | 11.2s | 0 | 3,646 | 0 | $0.018 |
| claude-sonnet-5-5 | semantic | tools | 13/15 (87%) | 62% to 96% | 12.2s | 1 | 15,290 | 9,437 | $0.028 |


Latency columns in the main run come from runs that shared one laptop with up to 10 concurrent agents. Use the latency run below.

## Latency run

### Scored against seed gold plus pooled judgments

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | agentic | 2/2 (100%) | 34% to 100% | 42.9s | 6 | 35,844 | 8,596 | $0.052 |
| claude-sonnet-5-5 | aggregate | codemode | 2/2 (100%) | 34% to 100% | 4.1s | 1 | 5,254 | 232 | $0.010 |
| claude-sonnet-5-5 | aggregate | rag | 0/2 (0%) | 0% to 66% | 5.4s | 0 | 3,795 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 2/2 (100%) | 34% to 100% | 10.9s | 7 | 44,327 | 20,457 | $0.068 |
| claude-sonnet-5-5 | all | agentic | 8/8 (100%) | 68% to 100% | 29.4s | 4.5 | 39,707 | 11,494 | $0.057 |
| claude-sonnet-5-5 | all | codemode | 8/8 (100%) | 68% to 100% | 7.3s | 1 | 5,794 | 863 | $0.010 |
| claude-sonnet-5-5 | all | rag | 2/8 (25%) | 7% to 59% | 5.4s | 0 | 3,438 | 0 | $0.017 |
| claude-sonnet-5-5 | all | tools | 7/8 (88%) | 53% to 98% | 8.8s | 2.5 | 28,456 | 15,176 | $0.048 |
| claude-sonnet-5-5 | hard | agentic | 2/2 (100%) | 34% to 100% | 30.5s | 4.5 | 30,518 | 8,559 | $0.059 |
| claude-sonnet-5-5 | hard | codemode | 2/2 (100%) | 34% to 100% | 8.3s | 1 | 5,103 | 76 | $0.008 |
| claude-sonnet-5-5 | hard | rag | 0/2 (0%) | 0% to 66% | 7.4s | 0 | 3,451 | 0 | $0.014 |
| claude-sonnet-5-5 | hard | tools | 1/2 (50%) | 9% to 91% | 50.3s | 7.5 | 53,562 | 31,872 | $0.093 |
| claude-sonnet-5-5 | identifier | agentic | 2/2 (100%) | 34% to 100% | 9.6s | 2 | 12,690 | 1,716 | $0.013 |
| claude-sonnet-5-5 | identifier | codemode | 2/2 (100%) | 34% to 100% | 7.3s | 1 | 4,987 | 115 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 0/2 (0%) | 0% to 66% | 5.6s | 0 | 2,984 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 2/2 (100%) | 34% to 100% | 8.0s | 1 | 6,031 | 322 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 2/2 (100%) | 34% to 100% | 29.4s | 6.5 | 79,777 | 27,106 | $0.103 |
| claude-sonnet-5-5 | semantic | codemode | 2/2 (100%) | 34% to 100% | 7.1s | 1.5 | 7,834 | 3,029 | $0.015 |
| claude-sonnet-5-5 | semantic | rag | 2/2 (100%) | 34% to 100% | 3.8s | 0 | 3,521 | 0 | $0.016 |
| claude-sonnet-5-5 | semantic | tools | 2/2 (100%) | 34% to 100% | 4.2s | 1 | 9,906 | 8,054 | $0.024 |

### Scored against seed gold only (strict)

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | agentic | 2/2 (100%) | 34% to 100% | 42.9s | 6 | 35,844 | 8,596 | $0.052 |
| claude-sonnet-5-5 | aggregate | codemode | 2/2 (100%) | 34% to 100% | 4.1s | 1 | 5,254 | 232 | $0.010 |
| claude-sonnet-5-5 | aggregate | rag | 0/2 (0%) | 0% to 66% | 5.4s | 0 | 3,795 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 2/2 (100%) | 34% to 100% | 10.9s | 7 | 44,327 | 20,457 | $0.068 |
| claude-sonnet-5-5 | all | agentic | 8/8 (100%) | 68% to 100% | 29.4s | 4.5 | 39,707 | 11,494 | $0.057 |
| claude-sonnet-5-5 | all | codemode | 8/8 (100%) | 68% to 100% | 7.3s | 1 | 5,794 | 863 | $0.010 |
| claude-sonnet-5-5 | all | rag | 2/8 (25%) | 7% to 59% | 5.4s | 0 | 3,438 | 0 | $0.017 |
| claude-sonnet-5-5 | all | tools | 7/8 (88%) | 53% to 98% | 8.8s | 2.5 | 28,456 | 15,176 | $0.048 |
| claude-sonnet-5-5 | hard | agentic | 2/2 (100%) | 34% to 100% | 30.5s | 4.5 | 30,518 | 8,559 | $0.059 |
| claude-sonnet-5-5 | hard | codemode | 2/2 (100%) | 34% to 100% | 8.3s | 1 | 5,103 | 76 | $0.008 |
| claude-sonnet-5-5 | hard | rag | 0/2 (0%) | 0% to 66% | 7.4s | 0 | 3,451 | 0 | $0.014 |
| claude-sonnet-5-5 | hard | tools | 1/2 (50%) | 9% to 91% | 50.3s | 7.5 | 53,562 | 31,872 | $0.093 |
| claude-sonnet-5-5 | identifier | agentic | 2/2 (100%) | 34% to 100% | 9.6s | 2 | 12,690 | 1,716 | $0.013 |
| claude-sonnet-5-5 | identifier | codemode | 2/2 (100%) | 34% to 100% | 7.3s | 1 | 4,987 | 115 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 0/2 (0%) | 0% to 66% | 5.6s | 0 | 2,984 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 2/2 (100%) | 34% to 100% | 8.0s | 1 | 6,031 | 322 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 2/2 (100%) | 34% to 100% | 29.4s | 6.5 | 79,777 | 27,106 | $0.103 |
| claude-sonnet-5-5 | semantic | codemode | 2/2 (100%) | 34% to 100% | 7.1s | 1.5 | 7,834 | 3,029 | $0.015 |
| claude-sonnet-5-5 | semantic | rag | 2/2 (100%) | 34% to 100% | 3.8s | 0 | 3,521 | 0 | $0.016 |
| claude-sonnet-5-5 | semantic | tools | 2/2 (100%) | 34% to 100% | 4.2s | 1 | 9,906 | 8,054 | $0.024 |

