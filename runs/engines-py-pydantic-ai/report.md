# Run engines-py-pydantic-ai

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.6s | 1 | 5,796 | 356 | $0.008 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 9.9s | 1 | 5,943 | 249 | $0.008 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 18.0s | 1 | 6,411 | 192 | $0.008 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 12.0s | 1 | 5,564 | 147 | $0.007 |
