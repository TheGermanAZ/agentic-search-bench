#!/usr/bin/env bash
# Full engine comparison: probe suite for every engine, then live benchmark questions (Sonnet) per engine.
# Usage: research/probes/engines/run-all.sh   (from the repo root)
set -u
ENGINES="${ENGINES:-quickjs-asyncify vercel-run quickjs-ng isolated-vm py-monty py-fastmcp py-pydantic-ai}"
QIDS="${QIDS:-agg-01,agg-05,agg-09,agg-13,agg-15,ide-16,ide-22,ide-25,hrd-01,hrd-04,hrd-07,hrd-09}"
MODEL="${MODEL:-claude-sonnet-5-5}"
for e in $ENGINES; do
  echo "=== probes $e"
  research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/run.ts --engine=$e > research/probes/engines/out/$e.log 2>&1
  tail -4 research/probes/engines/out/$e.log
done
for e in $ENGINES; do
  echo "=== live $e"
  pnpm -s bench --run=engines-$e --engine=$e --strategies=codemode --model=$MODEL --only=$QIDS --concurrency=4 > runs/engines-$e.log 2>&1
  tail -2 runs/engines-$e.log
done
