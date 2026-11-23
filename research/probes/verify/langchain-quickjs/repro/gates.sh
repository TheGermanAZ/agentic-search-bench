#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
PY=../../../../impls/langchain-quickjs/.venv/bin/python
$PY run_all.py both P3 P4 P5 P6 P7 P9 P12
