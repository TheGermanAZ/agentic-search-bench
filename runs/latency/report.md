# Run latency

## Scored against seed gold plus pooled judgments

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | agentic | 2/2 (100%) | 34% to 100% | 42.9s | 6 | 35,844 | 8,596 | $0.052 |
| claude-sonnet-5-5 | aggregate | codemode | 2/2 (100%) | 34% to 100% | 4.1s | 1 | 5,254 | 232 | $0.010 |
| claude-sonnet-5-5 | aggregate | rag | 0/2 (0%) | 0% to 66% | 5.4s | 0 | 3,795 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 2/2 (100%) | 34% to 100% | 10.9s | 7 | 44,327 | 20,457 | $0.068 |
| claude-sonnet-5-5 | all | agentic | 8/8 (100%) | 68% to 100% | 29.4s | 4.5 | 39,707 | 11,494 | $0.057 |
| claude-sonnet-5-5 | all | codemode | 8/8 (100%) | 68% to 100% | 7.3s | 1 | 5,794 | 863 | $0.010 |
| claude-sonnet-5-5 | all | rag | 2/8 (25%) | 7% to 59% | 5.4s | 0 | 3,438 | 0 | $0.017 |
| claude-sonnet-5-5 | all | tools | 7/8 (88%) | 53% to 98% | 8.8s | 2.5 | 28,456 | 15,176 | $0.048 |
| claude-sonnet-5-5 | hard | agentic | 2/2 (100%) | 34% to 100% | 30.5s | 4.5 | 30,518 | 8,559 | $0.059 |
| claude-sonnet-5-5 | hard | codemode | 2/2 (100%) | 34% to 100% | 8.3s | 1 | 5,103 | 76 | $0.008 |
| claude-sonnet-5-5 | hard | rag | 0/2 (0%) | 0% to 66% | 7.4s | 0 | 3,451 | 0 | $0.014 |
| claude-sonnet-5-5 | hard | tools | 1/2 (50%) | 9% to 91% | 50.3s | 7.5 | 53,562 | 31,872 | $0.093 |
| claude-sonnet-5-5 | identifier | agentic | 2/2 (100%) | 34% to 100% | 9.6s | 2 | 12,690 | 1,716 | $0.013 |
| claude-sonnet-5-5 | identifier | codemode | 2/2 (100%) | 34% to 100% | 7.3s | 1 | 4,987 | 115 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 0/2 (0%) | 0% to 66% | 5.6s | 0 | 2,984 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 2/2 (100%) | 34% to 100% | 8.0s | 1 | 6,031 | 322 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 2/2 (100%) | 34% to 100% | 29.4s | 6.5 | 79,777 | 27,106 | $0.103 |
| claude-sonnet-5-5 | semantic | codemode | 2/2 (100%) | 34% to 100% | 7.1s | 1.5 | 7,834 | 3,029 | $0.015 |
| claude-sonnet-5-5 | semantic | rag | 2/2 (100%) | 34% to 100% | 3.8s | 0 | 3,521 | 0 | $0.016 |
| claude-sonnet-5-5 | semantic | tools | 2/2 (100%) | 34% to 100% | 4.2s | 1 | 9,906 | 8,054 | $0.024 |

## Scored against seed gold only (strict)

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | aggregate | agentic | 2/2 (100%) | 34% to 100% | 42.9s | 6 | 35,844 | 8,596 | $0.052 |
| claude-sonnet-5-5 | aggregate | codemode | 2/2 (100%) | 34% to 100% | 4.1s | 1 | 5,254 | 232 | $0.010 |
| claude-sonnet-5-5 | aggregate | rag | 0/2 (0%) | 0% to 66% | 5.4s | 0 | 3,795 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 2/2 (100%) | 34% to 100% | 10.9s | 7 | 44,327 | 20,457 | $0.068 |
| claude-sonnet-5-5 | all | agentic | 8/8 (100%) | 68% to 100% | 29.4s | 4.5 | 39,707 | 11,494 | $0.057 |
| claude-sonnet-5-5 | all | codemode | 8/8 (100%) | 68% to 100% | 7.3s | 1 | 5,794 | 863 | $0.010 |
| claude-sonnet-5-5 | all | rag | 2/8 (25%) | 7% to 59% | 5.4s | 0 | 3,438 | 0 | $0.017 |
| claude-sonnet-5-5 | all | tools | 7/8 (88%) | 53% to 98% | 8.8s | 2.5 | 28,456 | 15,176 | $0.048 |
| claude-sonnet-5-5 | hard | agentic | 2/2 (100%) | 34% to 100% | 30.5s | 4.5 | 30,518 | 8,559 | $0.059 |
| claude-sonnet-5-5 | hard | codemode | 2/2 (100%) | 34% to 100% | 8.3s | 1 | 5,103 | 76 | $0.008 |
| claude-sonnet-5-5 | hard | rag | 0/2 (0%) | 0% to 66% | 7.4s | 0 | 3,451 | 0 | $0.014 |
| claude-sonnet-5-5 | hard | tools | 1/2 (50%) | 9% to 91% | 50.3s | 7.5 | 53,562 | 31,872 | $0.093 |
| claude-sonnet-5-5 | identifier | agentic | 2/2 (100%) | 34% to 100% | 9.6s | 2 | 12,690 | 1,716 | $0.013 |
| claude-sonnet-5-5 | identifier | codemode | 2/2 (100%) | 34% to 100% | 7.3s | 1 | 4,987 | 115 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 0/2 (0%) | 0% to 66% | 5.6s | 0 | 2,984 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 2/2 (100%) | 34% to 100% | 8.0s | 1 | 6,031 | 322 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 2/2 (100%) | 34% to 100% | 29.4s | 6.5 | 79,777 | 27,106 | $0.103 |
| claude-sonnet-5-5 | semantic | codemode | 2/2 (100%) | 34% to 100% | 7.1s | 1.5 | 7,834 | 3,029 | $0.015 |
| claude-sonnet-5-5 | semantic | rag | 2/2 (100%) | 34% to 100% | 3.8s | 0 | 3,521 | 0 | $0.016 |
| claude-sonnet-5-5 | semantic | tools | 2/2 (100%) | 34% to 100% | 4.2s | 1 | 9,906 | 8,054 | $0.024 |
