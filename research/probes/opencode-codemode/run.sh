#!/usr/bin/env bash
# Usage: research/probes/opencode-codemode/run.sh <default|deny|hardened> <P1..P12>
# Copies the harness into the pinned clone's packages/core (so workspace imports resolve) and runs it with Bun.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$HERE/../../impls/opencode-codemode/src/packages/core"
mkdir -p "$CORE/probe" "$HERE/out"
cp "$HERE/harness.ts" "$CORE/probe/harness.ts"
cd "$CORE"
PROBE_DATA_DIR="$HERE/out/session-data" PROBE_SECRET=s3cr3t exec bun probe/harness.ts "$1" "$2"
