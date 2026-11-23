# Run engines-py-monty

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.6s | 1 | 5,797 | 482 | $0.016 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 15.6s | 1 | 6,719 | 321 | $0.013 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 162.9s | 2 | 8,802 | 246 | $0.012 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 18.6s | 1 | 5,476 | 153 | $0.008 |
