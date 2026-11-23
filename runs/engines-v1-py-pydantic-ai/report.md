# Run engines-py-pydantic-ai

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 8.6s | 1 | 8,526 | 1,129 | $0.019 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 15.2s | 1 | 7,619 | 588 | $0.014 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 134.1s | 2 | 8,026 | 243 | $0.011 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 14.8s | 1 | 5,563 | 147 | $0.008 |
