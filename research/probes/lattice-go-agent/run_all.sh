#!/usr/bin/env bash
# Builds the Go harness in Docker (Go is not installed on the host) and runs every probe.
# Fast probes share one process; P6/P7 variants each get their own container. Raw JSON lines go to out/*.jsonl.
set -u
cd "$(dirname "$0")"
D() { docker run --rm --name "lattice-go-agent-probe-$1" -v "$PWD/harness":/src -v lattice-go-agent-gocache:/go/pkg/mod -w /src golang:1 sh -c "go mod tidy >/dev/null 2>&1; go build -o /tmp/probe . && /tmp/probe $2"; }
D fast P1,P1b,P2,P2b,P3,P3b,P4,P4b,P5,P5b,P8,P9,P10,P10b,P11,P12a,P12b,P12c,P12d > out/fast.jsonl 2>&1
D p6 P6 > out/P6.jsonl 2>&1
D p6b P6b > out/P6b.jsonl 2>&1
D p6c P6c > out/P6c.jsonl 2>&1
D p6d P6d > out/P6d.jsonl 2>&1
../mem-lock.sh bash -c "$(declare -f D); D p7 P7 > out/P7.jsonl 2>&1"
../mem-lock.sh bash -c "$(declare -f D); D p7b P7b > out/P7b.jsonl 2>&1"
../mem-lock.sh bash -c "$(declare -f D); D p7c P7c > out/P7c.jsonl 2>&1"
