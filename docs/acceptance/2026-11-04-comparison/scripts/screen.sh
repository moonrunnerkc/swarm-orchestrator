#!/bin/bash
# Screening: each task's held-out check and requirement record judged on a known-good patch (the
# human fix for the fix task, a reference change for the others) before any agent runs.
# Not edited once started.
cd "$(dirname "$0")"
C=/Users/brad/projects/recovery-2026-10-31/swarm-orchestrator/docs/acceptance/2026-11-04-comparison
for spec in fix-claimcheck:human feature-pubprep:reference refactor-ironroot:reference upgrade-claimcheck:reference; do
  t=${spec%%:*} kind=${spec##*:}
  echo "$(date -u +%FT%TZ) start $t" >> screen.log
  ./judge.sh "$C/$t" "$PWD/screen/$t.$kind.diff" "$PWD/screen/$t" >> screen.log 2>&1
  echo "$(date -u +%FT%TZ) end $t" >> screen.log
done
