# Run engines-vercel-run

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.1s | 1 | 5,377 | 306 | $0.009 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 8.5s | 1 | 6,193 | 587 | $0.009 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 19.0s | 1.5 | 7,473 | 271 | $0.010 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 10.2s | 1 | 5,846 | 1,478 | $0.010 |
