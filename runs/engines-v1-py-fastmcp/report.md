# Run engines-py-fastmcp

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.8s | 1 | 5,577 | 313 | $0.014 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 11.7s | 1 | 5,765 | 300 | $0.011 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 12.9s | 1 | 6,251 | 247 | $0.010 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 17.7s | 1 | 5,428 | 347 | $0.008 |
