# Run engines-py-monty

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.8s | 1 | 7,299 | 897 | $0.011 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 8.8s | 1 | 6,493 | 443 | $0.009 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 17.3s | 1 | 6,256 | 104 | $0.007 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 10.4s | 1 | 5,465 | 138 | $0.007 |
