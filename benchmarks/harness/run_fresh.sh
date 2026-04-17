#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# run_fresh.sh — Run fresh orchestrator benchmarks using
# standardized prompts from legacy_tasks.json
#
# Usage:
#   ./run_fresh.sh              # run all 8 tasks once (8 runs)
#   ./run_fresh.sh 12           # run until 12 total runs exist
#   TOOL=claude-code ./run_fresh.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/raw_data/runs"
TASKS_FILE="$SCRIPT_DIR/raw_data/legacy_tasks.json"
SCORE_SCRIPT="$SCRIPT_DIR/scoring/score.sh"
SWARM_BIN="$REPO_ROOT/dist/src/cli.js"
TOOL="${TOOL:-claude-code}"
TARGET_RUNS="${1:-10}"

if [ ! -f "$SWARM_BIN" ]; then
  echo "ERROR: Build the orchestrator first: npm run build" >&2
  exit 1
fi

mkdir -p "$RESULTS_DIR"

# Count existing fresh runs
existing=$(find "$RESULTS_DIR" -maxdepth 1 -type d -name "fresh-*" 2>/dev/null | wc -l)
echo "Existing fresh runs: $existing / target: $TARGET_RUNS"

# Extract tasks from JSON
TASK_COUNT=$(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))))")
echo "Tasks available: $TASK_COUNT"

task_index=0
run_num=$((existing + 1))

while [ "$run_num" -le "$TARGET_RUNS" ]; do
  # Cycle through tasks
  TASK_JSON=$(python3 -c "
import json
tasks = json.load(open('$TASKS_FILE'))
t = tasks[$task_index % len(tasks)]
print(json.dumps({'id': t['id'], 'goal': t['goal'], 'name': t['name']}))
")
  TASK_ID=$(echo "$TASK_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  TASK_GOAL=$(echo "$TASK_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['goal'])")
  TASK_NAME=$(echo "$TASK_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['name'])")

  TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
  RUN_DIR="$RESULTS_DIR/fresh-${TIMESTAMP}-${TASK_ID}"
  mkdir -p "$RUN_DIR"

  echo ""
  echo "════════════════════════════════════════════════════"
  echo "  Run $run_num / $TARGET_RUNS — $TASK_ID: $TASK_NAME"
  echo "  Dir: $RUN_DIR"
  echo "════════════════════════════════════════════════════"

  START_SEC=$(date +%s)

  # Run the orchestrator
  node "$SWARM_BIN" run \
    --goal "$TASK_GOAL" \
    --tool "$TOOL" \
    --yes \
    > "$RUN_DIR/orchestrator_stdout.txt" 2>&1 || true

  END_SEC=$(date +%s)
  ELAPSED=$(( END_SEC - START_SEC ))

  # Capture the latest swarm run directory (most recent in runs/)
  LATEST_SWARM=$(ls -dt "$REPO_ROOT/runs/swarm-"* 2>/dev/null | head -1)
  if [ -n "$LATEST_SWARM" ] && [ -d "$LATEST_SWARM" ]; then
    # Copy key artifacts into our fresh run directory
    for f in session-state.json metrics.json cost-attribution.json; do
      [ -f "$LATEST_SWARM/$f" ] && cp "$LATEST_SWARM/$f" "$RUN_DIR/"
    done
    [ -d "$LATEST_SWARM/quality-gates" ] && cp -r "$LATEST_SWARM/quality-gates" "$RUN_DIR/"

    # Score it
    bash "$SCORE_SCRIPT" "$RUN_DIR" || true
  fi

  # Write run metadata
  cat > "$RUN_DIR/run-meta.json" <<METAEOF
{
  "task_id": "$TASK_ID",
  "task_name": "$TASK_NAME",
  "tool": "$TOOL",
  "timestamp": "$TIMESTAMP",
  "elapsed_seconds": $ELAPSED,
  "swarm_run_dir": "$(basename "$LATEST_SWARM" 2>/dev/null || echo "")"
}
METAEOF

  echo "  ✓ Completed in ${ELAPSED}s"

  task_index=$(( task_index + 1 ))
  run_num=$(( run_num + 1 ))
done

echo ""
echo "════════════════════════════════════════════════════"
echo "  All runs complete. Total fresh runs: $(find "$RESULTS_DIR" -maxdepth 1 -type d -name "fresh-*" | wc -l)"
echo "════════════════════════════════════════════════════"
echo ""
echo "Next: python3 benchmarks/harness/scoring/compute_ci.py $RESULTS_DIR"
