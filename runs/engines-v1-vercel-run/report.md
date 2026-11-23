# Run engines-vercel-run

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | codemode | 5/5 (100%) | 57% to 100% | 4.5s | 1 | 5,382 | 306 | $0.015 |
| claude-sonnet-5-5 | all | codemode | 12/12 (100%) | 76% to 100% | 13.4s | 1 | 5,818 | 326 | $0.012 |
| claude-sonnet-5-5 | hard | codemode | 4/4 (100%) | 51% to 100% | 16.0s | 1.5 | 6,785 | 299 | $0.011 |
| claude-sonnet-5-5 | identifier | codemode | 3/3 (100%) | 44% to 100% | 17.2s | 1 | 5,254 | 397 | $0.008 |
