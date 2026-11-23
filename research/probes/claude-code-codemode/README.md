# claude-code-codemode probe harness

Code Mode refuses `claude -p`, so `driver.py` drives an interactive `claude --model haiku` in tmux with
`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` for that invocation only, asks Haiku to run each probe's exact code through the
REPL tool, and reads the transcript JSONL Claude Code writes under `~/.claude/projects/<work dir>/`. When Haiku refuses,
the PreToolUse hook in the settings file (`inject-hook.py`) swaps the probe code in for the model's `1+1`, and the record says so.

```bash
cd research/probes/claude-code-codemode
python3 driver.py default  $PWD/settings-default.json  default P0,P1,P2,P3,P3b,P4,P4b,P5,P5b,P6,P6b,P6c,P8,P9,P10,P12
python3 driver.py nohook   $PWD/settings-nohook.json   default P11
python3 driver.py hardened $PWD/settings-hardened.json default P3,P3b,P4,P4b,P5,P5b,P6,P9,P12
../mem-lock.sh python3 driver.py default  $PWD/settings-default.json  default P7 --rss-guard
../mem-lock.sh python3 driver.py hardened $PWD/settings-hardened.json default P7 --rss-guard --inject
```

First run only: Claude Code asks to trust `work/` and to confirm Code Mode; both answers are saved in `~/.claude.json`.
`out/run1-shared-session/` is an earlier attempt that ran all probes in one session; it shows Haiku refusing later probes after a declined prompt.
