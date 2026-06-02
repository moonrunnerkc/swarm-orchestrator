#!/usr/bin/env bash
# One-shot progress snapshot for the execution-grounded evidence run.
cd "$(dirname "$0")/../.."
LOG=/tmp/eg-pipeline.log
EGDIR=benchmarks/regression-corpus/execution-grounded
CLEANDIR=benchmarks/real-prs/execution-grounded-clean

phase=$(grep "PHASE" "$LOG" 2>/dev/null | tail -1 | sed 's/.*=== //')
cur=$(grep "^\[eg-run\] run:" "$LOG" 2>/dev/null | tail -1 | sed 's/\[eg-run\] //')
lastdone=$(grep "done .*findings" "$LOG" 2>/dev/null | tail -1 | sed 's/\[eg-run\] //')
reg=$(find "$EGDIR" -name result.json 2>/dev/null | wc -l | tr -d ' ')
cln=$(find "$CLEANDIR" -name result.json 2>/dev/null | wc -l | tr -d ' ')
alive=$(pgrep -f run-execution-grounded >/dev/null && echo yes || echo no)
pipealive=$(pgrep -f eg-evidence-pipeline >/dev/null && echo yes || echo no)

echo "time: $(date +%H:%M:%S)"
echo "phase: ${phase:-?}"
echo "regression results: ${reg}/72   clean results: ${cln}"
echo "current: ${cur:-<provisioning/none>}"
echo "last done: ${lastdone:-none}"
echo "runner alive: ${alive}   pipeline alive: ${pipealive}"
leak=$(pgrep -f "ms-playwright/chromium|playwright_chromiumdev_profile|swarm-eg-run.*chrom" 2>/dev/null | tr '\n' ' ')
echo "browser-leak: ${leak:-none}"
if [ -f "$EGDIR/correlation.json" ]; then
  echo "CORRELATION READY:"
  node -e 'console.log(JSON.stringify(require("./'"$EGDIR"'/correlation.json").headline))' 2>/dev/null
fi
