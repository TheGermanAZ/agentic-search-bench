#!/usr/bin/env bash
# Runs every robustness test for every candidate (one background chain per implementation).
set -u
cd "$(dirname "$0")"
export PYDANTIC_AI_NO_BANNER=1
D="R1 R1c R2a R2b R2c R3 R4 R5 R6 R7a R7b R8a R8b R9a R9d R9e R9b R9c"
H="R2b R4 R5 R6 R7a R7b R8a R8b R9a R9d R9e R9b R9c"
only="${*:-vercel-run vercel-ai-sdk-codemode tanstack-ai-codemode-node pi-codemode utcp-codemode asb-quickjs langchain-quickjs pydantic-ai-harness-codemode fastmcp-codemode openclaw-codemode-quickjs-wasi strands-codemode bifrost-codemode hermes-execute-code}"
for i in $only; do
  case $i in
    asb-quickjs) ( _js/run-tests.sh $i default bun $D A1 A4 A5 ) > $i/robust.log 2>&1 & ;;
    openclaw-codemode-quickjs-wasi) ( _js/run-tests.sh $i default node $D; _js/run-tests.sh $i hardened node $H ) > $i/robust.log 2>&1 & ;;
    strands-codemode) ( _py/run-tests.sh $i default $D; _py/run-tests.sh $i hardened $H ) > $i/robust.log 2>&1 & ;;
    # Bifrost runs in Docker: bifrost-codemode/run.sh restarts the gateway container before every test.
    bifrost-codemode) ( bifrost-codemode/run.sh default $D; bifrost-codemode/run.sh hardened $H ) > $i/robust.log 2>&1 & ;;
    # Hermes: hardened Docker backend only (the default local backend already fails isolation, P4/P12).
    hermes-execute-code) ( for t in $D; do _py/run-tests.sh $i hardened $t; ../hermes-execute-code/docker_cleanup.sh > $i/out/hardened-$t.docker.txt; done ) > $i/robust.log 2>&1 & ;;
    langchain-quickjs|pydantic-ai-harness-codemode|fastmcp-codemode) ( _py/run-tests.sh $i default $D; _py/run-tests.sh $i hardened $H ) > $i/robust.log 2>&1 & ;;
    *) ( _js/run-tests.sh $i default node $D; _js/run-tests.sh $i hardened node $H ) > $i/robust.log 2>&1 & ;;
  esac
done
wait
