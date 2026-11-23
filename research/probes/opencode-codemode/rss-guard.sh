#!/usr/bin/env bash
# Usage: rss-guard.sh <outfile> <command...>
# Runs the command, samples its RSS every 250 ms, kills it at 4 GB RSS or 120 s (SPEC P7), and appends a summary.
set -u
out="$1"; shift
start=$(date +%s)
"$@" > "$out" 2>&1 &
pid=$!
peak=0; reason="exited"
while kill -0 "$pid" 2>/dev/null; do
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -n "$rss" ] && [ "$rss" -gt "$peak" ] && peak=$rss
  if [ -n "$rss" ] && [ "$rss" -gt 4194304 ]; then reason="killed-at-4GB"; kill -9 "$pid"; break; fi
  if [ $(( $(date +%s) - start )) -ge 120 ]; then reason="killed-at-120s"; kill -9 "$pid"; break; fi
  sleep 0.25
done
wait "$pid" 2>/dev/null; code=$?
echo "{\"guard\": {\"reason\": \"$reason\", \"exitCode\": $code, \"peakRssKB\": $peak, \"wallS\": $(( $(date +%s) - start ))}}" >> "$out"
