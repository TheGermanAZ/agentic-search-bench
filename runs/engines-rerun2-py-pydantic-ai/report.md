# Run engines-rerun2-py-pydantic-ai

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 5.0s | 1 | 5,797 | 358 | $0.008 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 14.4s | 1 | 6,482 | 258 | $0.009 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 123.1s | 1.5 | 8,037 | 218 | $0.010 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 16.8s | 1 | 5,553 | 143 | $0.007 |
