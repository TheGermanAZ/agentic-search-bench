#!/usr/bin/env bash
# Runs one command while holding a machine-wide lock, so only one memory probe runs at a time.
# Usage: research/probes/mem-lock.sh <command> [args...]
set -u
LOCK="${TMPDIR:-/tmp}/asb-mem-probe.lock"
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  # A lock older than 10 minutes belongs to a worker that died; take it over.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; continue; fi
  sleep 2
  waited=$((waited + 2))
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
[ "$waited" -gt 0 ] && echo "mem-lock: waited ${waited}s" >&2
"$@"
