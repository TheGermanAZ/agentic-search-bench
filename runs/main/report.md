# Run main

## Scored against seed gold plus pooled judgments

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | aggregate | agentic | 13/15 (87%) | 62% to 96% | 123.3s | 19 | 102,686 | 26,610 | $0.012 |
| claude-haiku-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 14.3s | 1 | 7,012 | 877 | $0.001 |
| claude-haiku-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 16.5s | 0 | 3,883 | 0 | $0.002 |
| claude-haiku-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 38.3s | 10 | 38,827 | 13,391 | $0.004 |
| claude-haiku-5-5 | all | agentic | 46/50 (92%) | 81% to 97% | 109.1s | 13 | 168,836 | 27,084 | $0.011 |
| claude-haiku-5-5 | all | codemode | 50/50 (100%) | 93% to 100% | 67.2s | 2 | 12,849 | 4,773 | $0.001 |
| claude-haiku-5-5 | all | rag | 17/50 (34%) | 22% to 48% | 38.1s | 0 | 3,609 | 0 | $0.001 |
| claude-haiku-5-5 | all | tools | 50/50 (100%) | 93% to 100% | 99.1s | 3 | 26,034 | 13,643 | $0.003 |
| claude-haiku-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 113.7s | 25 | 134,234 | 24,589 | $0.010 |
| claude-haiku-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 83.4s | 2 | 9,652 | 1,292 | $0.001 |
| claude-haiku-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 23.3s | 0 | 3,389 | 0 | $0.002 |
| claude-haiku-5-5 | hard | tools | 10/10 (100%) | 72% to 100% | 208.4s | 5 | 34,443 | 23,190 | $0.005 |
| claude-haiku-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 61.6s | 2 | 133,980 | 2,727 | $0.008 |
| claude-haiku-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 98.8s | 1 | 5,805 | 385 | $0.001 |
| claude-haiku-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 51.2s | 0 | 3,329 | 0 | $0.001 |
| claude-haiku-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 99.1s | 2 | 6,975 | 1,243 | $0.001 |
| claude-haiku-5-5 | semantic | agentic | 14/15 (93%) | 70% to 99% | 157.6s | 13 | 281,292 | 45,460 | $0.013 |
| claude-haiku-5-5 | semantic | codemode | 15/15 (100%) | 80% to 100% | 126.1s | 2 | 25,513 | 13,915 | $0.003 |
| claude-haiku-5-5 | semantic | rag | 11/15 (73%) | 48% to 89% | 64.0s | 0 | 3,668 | 0 | $0.001 |
| claude-haiku-5-5 | semantic | tools | 15/15 (100%) | 80% to 100% | 147.2s | 2 | 20,342 | 15,796 | $0.003 |
| claude-sonnet-5-5 | aggregate | agentic | 14/15 (93%) | 70% to 99% | 88.4s | 5 | 64,584 | 25,628 | $0.106 |
| claude-sonnet-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 4.7s | 1 | 5,438 | 292 | $0.011 |
| claude-sonnet-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 5.6s | 0 | 3,864 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 8.6s | 2 | 22,357 | 9,889 | $0.041 |
| claude-sonnet-5-5 | all | agentic | 48/50 (96%) | 87% to 99% | 92.0s | 8 | 75,374 | 15,838 | $0.083 |
| claude-sonnet-5-5 | all | codemode | 50/50 (100%) | 93% to 100% | 16.9s | 1 | 9,650 | 1,936 | $0.014 |
| claude-sonnet-5-5 | all | rag | 17/50 (34%) | 22% to 48% | 11.6s | 0 | 3,588 | 0 | $0.018 |
| claude-sonnet-5-5 | all | tools | 49/50 (98%) | 90% to 100% | 15.5s | 2 | 18,330 | 9,312 | $0.034 |
| claude-sonnet-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 157.1s | 13 | 69,637 | 10,312 | $0.091 |
| claude-sonnet-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 129.6s | 1 | 6,258 | 191 | $0.010 |
| claude-sonnet-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 49.9s | 0 | 3,368 | 0 | $0.018 |
| claude-sonnet-5-5 | hard | tools | 9/10 (90%) | 60% to 98% | 225.9s | 3 | 29,154 | 17,221 | $0.058 |
| claude-sonnet-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 28.1s | 2 | 19,845 | 1,663 | $0.020 |
| claude-sonnet-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 18.0s | 1 | 5,035 | 239 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 13.3s | 0 | 3,307 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 17.4s | 1 | 6,026 | 351 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 15/15 (100%) | 80% to 100% | 81.1s | 10 | 127,008 | 19,181 | $0.097 |
| claude-sonnet-5-5 | semantic | codemode | 15/15 (100%) | 80% to 100% | 17.4s | 2 | 19,200 | 5,875 | $0.026 |
| claude-sonnet-5-5 | semantic | rag | 11/15 (73%) | 48% to 89% | 11.2s | 0 | 3,646 | 0 | $0.018 |
| claude-sonnet-5-5 | semantic | tools | 15/15 (100%) | 80% to 100% | 12.2s | 1 | 15,290 | 9,437 | $0.028 |

## Scored against seed gold only (strict)

| model | questions | strategy | correct | 95% CI | median latency | median tool calls | mean input tokens | mean tool output chars | mean cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | aggregate | agentic | 13/15 (87%) | 62% to 96% | 123.3s | 19 | 102,686 | 26,610 | $0.012 |
| claude-haiku-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 14.3s | 1 | 7,012 | 877 | $0.001 |
| claude-haiku-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 16.5s | 0 | 3,883 | 0 | $0.002 |
| claude-haiku-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 38.3s | 10 | 38,827 | 13,391 | $0.004 |
| claude-haiku-5-5 | all | agentic | 41/50 (82%) | 69% to 90% | 109.1s | 13 | 168,836 | 27,084 | $0.011 |
| claude-haiku-5-5 | all | codemode | 47/50 (94%) | 84% to 98% | 67.2s | 2 | 12,849 | 4,773 | $0.001 |
| claude-haiku-5-5 | all | rag | 16/50 (32%) | 21% to 46% | 38.1s | 0 | 3,609 | 0 | $0.001 |
| claude-haiku-5-5 | all | tools | 47/50 (94%) | 84% to 98% | 99.1s | 3 | 26,034 | 13,643 | $0.003 |
| claude-haiku-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 113.7s | 25 | 134,234 | 24,589 | $0.010 |
| claude-haiku-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 83.4s | 2 | 9,652 | 1,292 | $0.001 |
| claude-haiku-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 23.3s | 0 | 3,389 | 0 | $0.002 |
| claude-haiku-5-5 | hard | tools | 10/10 (100%) | 72% to 100% | 208.4s | 5 | 34,443 | 23,190 | $0.005 |
| claude-haiku-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 61.6s | 2 | 133,980 | 2,727 | $0.008 |
| claude-haiku-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 98.8s | 1 | 5,805 | 385 | $0.001 |
| claude-haiku-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 51.2s | 0 | 3,329 | 0 | $0.001 |
| claude-haiku-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 99.1s | 2 | 6,975 | 1,243 | $0.001 |
| claude-haiku-5-5 | semantic | agentic | 9/15 (60%) | 36% to 80% | 157.6s | 13 | 281,292 | 45,460 | $0.013 |
| claude-haiku-5-5 | semantic | codemode | 12/15 (80%) | 55% to 93% | 126.1s | 2 | 25,513 | 13,915 | $0.003 |
| claude-haiku-5-5 | semantic | rag | 10/15 (67%) | 42% to 85% | 64.0s | 0 | 3,668 | 0 | $0.001 |
| claude-haiku-5-5 | semantic | tools | 12/15 (80%) | 55% to 93% | 147.2s | 2 | 20,342 | 15,796 | $0.003 |
| claude-sonnet-5-5 | aggregate | agentic | 14/15 (93%) | 70% to 99% | 88.4s | 5 | 64,584 | 25,628 | $0.106 |
| claude-sonnet-5-5 | aggregate | codemode | 15/15 (100%) | 80% to 100% | 4.7s | 1 | 5,438 | 292 | $0.011 |
| claude-sonnet-5-5 | aggregate | rag | 2/15 (13%) | 4% to 38% | 5.6s | 0 | 3,864 | 0 | $0.020 |
| claude-sonnet-5-5 | aggregate | tools | 15/15 (100%) | 80% to 100% | 8.6s | 2 | 22,357 | 9,889 | $0.041 |
| claude-sonnet-5-5 | all | agentic | 43/50 (86%) | 74% to 93% | 92.0s | 8 | 75,374 | 15,838 | $0.083 |
| claude-sonnet-5-5 | all | codemode | 48/50 (96%) | 87% to 99% | 16.9s | 1 | 9,650 | 1,936 | $0.014 |
| claude-sonnet-5-5 | all | rag | 16/50 (32%) | 21% to 46% | 11.6s | 0 | 3,588 | 0 | $0.018 |
| claude-sonnet-5-5 | all | tools | 47/50 (94%) | 84% to 98% | 15.5s | 2 | 18,330 | 9,312 | $0.034 |
| claude-sonnet-5-5 | hard | agentic | 9/10 (90%) | 60% to 98% | 157.1s | 13 | 69,637 | 10,312 | $0.091 |
| claude-sonnet-5-5 | hard | codemode | 10/10 (100%) | 72% to 100% | 129.6s | 1 | 6,258 | 191 | $0.010 |
| claude-sonnet-5-5 | hard | rag | 0/10 (0%) | 0% to 28% | 49.9s | 0 | 3,368 | 0 | $0.018 |
| claude-sonnet-5-5 | hard | tools | 9/10 (90%) | 60% to 98% | 225.9s | 3 | 29,154 | 17,221 | $0.058 |
| claude-sonnet-5-5 | identifier | agentic | 10/10 (100%) | 72% to 100% | 28.1s | 2 | 19,845 | 1,663 | $0.020 |
| claude-sonnet-5-5 | identifier | codemode | 10/10 (100%) | 72% to 100% | 18.0s | 1 | 5,035 | 239 | $0.008 |
| claude-sonnet-5-5 | identifier | rag | 4/10 (40%) | 17% to 69% | 13.3s | 0 | 3,307 | 0 | $0.017 |
| claude-sonnet-5-5 | identifier | tools | 10/10 (100%) | 72% to 100% | 17.4s | 1 | 6,026 | 351 | $0.008 |
| claude-sonnet-5-5 | semantic | agentic | 10/15 (67%) | 42% to 85% | 81.1s | 10 | 127,008 | 19,181 | $0.097 |
| claude-sonnet-5-5 | semantic | codemode | 13/15 (87%) | 62% to 96% | 17.4s | 2 | 19,200 | 5,875 | $0.026 |
| claude-sonnet-5-5 | semantic | rag | 10/15 (67%) | 42% to 85% | 11.2s | 0 | 3,646 | 0 | $0.018 |
| claude-sonnet-5-5 | semantic | tools | 13/15 (87%) | 62% to 96% | 12.2s | 1 | 15,290 | 9,437 | $0.028 |
