#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
export PYDANTIC_AI_NO_BANNER=1 PY=../../../../impls/pydantic-ai-harness-codemode/.venv/bin/python
$PY harness.py P3 P4 P5 P6 P9 P12 && ../../../mem-lock.sh $PY harness.py P7
$PY harness.py --hardened P3 P4 P5 P6 P9 P12 && ../../../mem-lock.sh $PY harness.py --hardened P7
