# Run engines-isolated-vm

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.0s | 1 | 5,378 | 298 | $0.009 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 10.0s | 1 | 6,327 | 558 | $0.009 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 19.3s | 1 | 6,692 | 182 | $0.008 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 12.6s | 1 | 7,425 | 1,492 | $0.011 |
