# Run engines-py-fastmcp

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.6s | 1 | 5,598 | 322 | $0.008 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 10.9s | 1 | 6,030 | 310 | $0.008 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 22.2s | 1.5 | 7,021 | 266 | $0.009 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 13.2s | 1 | 5,428 | 347 | $0.007 |
