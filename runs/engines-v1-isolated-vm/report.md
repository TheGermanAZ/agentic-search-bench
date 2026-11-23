# Run engines-isolated-vm

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 5.4s | 1 | 5,383 | 298 | $0.009 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 12.0s | 1 | 5,592 | 368 | $0.009 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 15.8s | 1 | 5,986 | 232 | $0.009 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 15.5s | 1 | 5,413 | 666 | $0.008 |
