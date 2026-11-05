#!/bin/bash
# Copies one task's two attempts and their judgments into the comparison record. Usage: collect.sh <task>
set -eu
W=/Users/brad/projects/recovery-2026-10-31
name=$1
from=$W/comparison/$name
to=$W/swarm-orchestrator/docs/acceptance/2026-11-04-comparison/$name
judged() {
  mkdir -p "$2/judged/verdict"
  cp "$1/result.txt" "$1/start.txt" "$1/seal.out" "$1/verify.out" "$1/replay.out" "$1/source-check.txt" "$2/judged/"
  cp "$1/verdict/statement.json" "$1/verdict/attestation.sigstore.json" "$1/verdict/attestation.pub.pem" "$2/judged/verdict/"
}
s=$from/swarm/attempt-1
mkdir -p "$to/swarm"
cp "$s/start.txt" "$s/run.out" "$s/replay.out" "$s/wall.txt" "$s/patch.diff" "$s/patch-source.txt" "$s/source-check.txt" "$s/setup.log" "$to/swarm/"
session=$(awk '$1=="evidence"{print $2; exit}' "$s/run.out")
cp "$session/final/report.md" "$session/final/report.json" "$to/swarm/"
basename "$session" > "$to/swarm/session.txt"
grep '^\$ \|^edit \|^write \|^replace \|^requirements\|^verifying\|^review\|^escalating\|^compacted\|^finalizing' "$s/run.err" > "$to/swarm/trace.txt" || true
judged "$s/judged" "$to/swarm"
c=$from/claude
mkdir -p "$to/claude"
cp "$c/start.txt" "$c/agent-report.md" "$c/patch.diff" "$c/source-check.txt" "$c/setup.log" "$to/claude/"
judged "$c/judged" "$to/claude"
[ -f "$s/held-out-host.out" ] && cp "$s/held-out-host.out" "$to/swarm/" || true
du -sh "$to"
