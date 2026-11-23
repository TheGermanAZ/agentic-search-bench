# Run engines-rerun2-py-monty

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 5.8s | 1 | 5,697 | 342 | $0.008 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 13.6s | 1 | 6,118 | 262 | $0.008 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 17.5s | 1 | 7,127 | 244 | $0.009 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 16.9s | 1 | 5,474 | 153 | $0.007 |
