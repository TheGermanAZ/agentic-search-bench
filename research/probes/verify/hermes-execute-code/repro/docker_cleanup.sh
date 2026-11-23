#!/usr/bin/env bash
# Removes only the containers this probe created: Hermes names them hermes-<hex> itself
# (tools/environments/docker.py:1039), so they are found by the label the hardened config adds
# through docker_extra_args. Before removal it records each container's state (OOMKilled, exit code,
# memory limit) to stdout.
set -u
for id in $(docker ps -aq --filter label=asb-impl=hermes-execute-code); do
  docker inspect --format '{{.Name}} oom_killed={{.State.OOMKilled}} exit={{.State.ExitCode}} status={{.State.Status}} mem_limit={{.HostConfig.Memory}} network={{.HostConfig.NetworkMode}} cap_drop={{.HostConfig.CapDrop}} pids_limit={{.HostConfig.PidsLimit}}' "$id"
  docker rm -f "$id" > /dev/null
done
