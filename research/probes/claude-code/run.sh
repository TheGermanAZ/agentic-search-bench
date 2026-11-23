#!/bin/sh
# Usage: ./run.sh sandbox-on.json out/run1   (writes <prefix>.jsonl)
set -u
cd "$(dirname "$0")"
PROBE_SECRET=s3cr3t claude -p "$(cat prompt.txt)" \
  --model haiku --setting-sources "" --settings "$1" \
  --tools Bash --max-turns 8 --no-session-persistence \
  --output-format stream-json --verbose > "$2.jsonl" 2> "$2.stderr" < /dev/null
echo "exit=$?"
