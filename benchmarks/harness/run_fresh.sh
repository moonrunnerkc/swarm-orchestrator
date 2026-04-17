#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# run_fresh.sh — Three-producer benchmark harness
#
# Producers:
#   ORCHESTRATOR — swarm bootstrap (full orchestration)
#   SINGLE_SHOT  — Claude Code CLI, one request, 1 premium request
#   LADDER       — Claude Code CLI, deterministic prompt ladder
#                  up to BUDGET_CAP requests, re-scored after each
#
# Usage:
#   ./run_fresh.sh                           # 8 runs per producer (all)
#   ./run_fresh.sh 24                        # 24 runs per producer
#   PRODUCER=ORCHESTRATOR ./run_fresh.sh 8   # orchestrator only
#   PRODUCER=SINGLE_SHOT  ./run_fresh.sh 8   # single-shot only
#   PRODUCER=LADDER        ./run_fresh.sh 8  # ladder only
#   PRODUCER=ALL           ./run_fresh.sh 24 # all three (default)
#
# D2: Deterministic round-robin — run_index mod task_count.
# D6: Three-producer design enables cost-vs-completeness comparison.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/raw_data/runs"
RUBRIC_TASKS="$SCRIPT_DIR/raw_data/rubric_tasks.json"
LEGACY_TASKS="$SCRIPT_DIR/raw_data/legacy_tasks.json"
SCORE_SCRIPT="$SCRIPT_DIR/scoring/score.sh"
RUBRIC_RUNNER="$SCRIPT_DIR/scoring/rubric_runner.py"
LADDER_SCRIPT="$SCRIPT_DIR/../ladder/run_ladder.sh"
SWARM_BIN="$REPO_ROOT/dist/src/cli.js"
TOOL="${TOOL:-claude-code}"
PRODUCER="${PRODUCER:-ALL}"
TARGET_RUNS="${1:-8}"
BUDGET_CAP="${BUDGET_CAP:-30}"

# Prefer rubric tasks; fall back to legacy
if [ -f "$RUBRIC_TASKS" ]; then
  TASKS_FILE="$RUBRIC_TASKS"
else
  TASKS_FILE="$LEGACY_TASKS"
fi

TASK_COUNT=$(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))))")

# D2: Warn on partial cycles
if [ $(( TARGET_RUNS % TASK_COUNT )) -ne 0 ]; then
  echo "WARNING: $TARGET_RUNS runs is not a multiple of $TASK_COUNT tasks — last cycle will be partial." >&2
fi

mkdir -p "$RESULTS_DIR"

echo "Tasks:    $TASK_COUNT  ($(basename "$TASKS_FILE"))"
echo "Producer: $PRODUCER"
echo "Runs:     $TARGET_RUNS per producer"
echo "Budget:   $BUDGET_CAP (ladder cap)"
echo ""

# ── helpers ───────────────────────────────────────────────────
task_field() {
  # task_field <index> <field>
  python3 -c "
import json, sys
t = json.load(open('$TASKS_FILE'))[$1]
# rubric_tasks uses 'prompt'; legacy uses 'goal'
val = t.get('$2', t.get('goal' if '$2' == 'prompt' else '$2', ''))
print(val)
"
}

# ── ORCHESTRATOR ──────────────────────────────────────────────
run_orchestrator() {
  local task_id="$1" task_prompt="$2" run_dir="$3" workspace="$4"

  if [ ! -f "$SWARM_BIN" ]; then
    echo "ERROR: Build first — npm run build" >&2
    return 1
  fi

  # Run swarm inside the workspace directory
  (cd "$workspace" && node "$SWARM_BIN" run \
    --goal "$task_prompt" \
    --tool "$TOOL" \
    --yes \
    > "$run_dir/orchestrator_stdout.txt" 2>&1) || true

  # Copy metadata artifacts from the inner swarm run directory
  local latest
  latest=$(ls -dt "$workspace/runs/swarm-"* 2>/dev/null | head -1 || true)
  if [ -n "$latest" ] && [ -d "$latest" ]; then
    for f in session-state.json metrics.json cost-attribution.json; do
      [ -f "$latest/$f" ] && cp "$latest/$f" "$run_dir/"
    done
    [ -d "$latest/quality-gates" ] && cp -r "$latest/quality-gates" "$run_dir/"
  fi
}

# ── SINGLE_SHOT ───────────────────────────────────────────────
run_single_shot() {
  local task_prompt="$1" run_dir="$2" workspace="$3"

  # Run claude inside the workspace directory so generated files land there
  (cd "$workspace" && claude --dangerously-skip-permissions -p "$task_prompt" \
    > "$run_dir/baseline_stdout.txt" 2>&1) || true

  # Exactly 1 premium request by definition
  cat > "$run_dir/cost-attribution.json" <<-COST
	{
	  "totalEstimatedPremiumRequests": 1,
	  "totalActualPremiumRequests": 1,
	  "estimateAccuracy": 1.0,
	  "modelUsed": "claude-sonnet-4",
	  "modelMultiplier": 1,
	  "overageTriggered": false,
	  "perStep": [{
	    "stepNumber": 1,
	    "agentName": "baseline-single-shot",
	    "estimatedPremiumRequests": 1,
	    "actualPremiumRequests": 1,
	    "retryCount": 0,
	    "promptTokens": 0,
	    "fleetMode": false,
	    "durationMs": 0
	  }]
	}
	COST
}

# ── LADDER ────────────────────────────────────────────────────
run_ladder() {
  local task_index="$1" run_dir="$2" workspace="$3"

  # Delegate to external ladder script if present
  if [ -x "$LADDER_SCRIPT" ]; then
    bash "$LADDER_SCRIPT" "$TASKS_FILE" "$task_index" "$run_dir" "$BUDGET_CAP" "$workspace" || true
    return
  fi

  # Inline fallback: iterate ladder_prompts from task definition
  local request_count=0
  local prompts
  prompts=$(python3 -c "
import json
t = json.load(open('$TASKS_FILE'))[$task_index % $(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))))")]
for p in t.get('ladder_prompts', [t.get('prompt', t.get('goal',''))]):
    print(p)
")

  while IFS= read -r prompt; do
    [ -z "$prompt" ] && continue
    if [ "$request_count" -ge "$BUDGET_CAP" ]; then
      echo "  Budget cap ($BUDGET_CAP) reached"
      break
    fi
    request_count=$((request_count + 1))
    echo "  Ladder step $request_count: ${prompt:0:80}..."
    (cd "$workspace" && claude --dangerously-skip-permissions -p "$prompt" \
      >> "$run_dir/ladder_stdout.txt" 2>&1) || true
  done <<< "$prompts"

  cat > "$run_dir/cost-attribution.json" <<-COST
	{
	  "totalEstimatedPremiumRequests": $request_count,
	  "totalActualPremiumRequests": $request_count,
	  "estimateAccuracy": 1.0,
	  "modelUsed": "claude-sonnet-4",
	  "modelMultiplier": 1,
	  "overageTriggered": false,
	  "perStep": []
	}
	COST
}

# ── main loop ─────────────────────────────────────────────────
run_producer() {
  local pname="$1"
  local pdir="$RESULTS_DIR/$pname"
  mkdir -p "$pdir"

  local existing
  existing=$(find "$pdir" -maxdepth 1 -type d -name "run-*" 2>/dev/null | wc -l)
  local n=$((existing + 1))

  while [ "$n" -le "$TARGET_RUNS" ]; do
    local tidx
    if [ -n "${TASK_INDEX:-}" ]; then
      tidx="$TASK_INDEX"
    else
      tidx=$(( (n - 1) % TASK_COUNT ))
    fi
    local task_id task_prompt task_name
    task_id=$(task_field "$tidx" "id")
    task_prompt=$(task_field "$tidx" "prompt")
    task_name=$(task_field "$tidx" "name")
    [ -z "$task_name" ] && task_name="$task_id"

    local ts
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    local rdir="$pdir/run-${ts}-${task_id}"
    mkdir -p "$rdir"

    # Create isolated workspace for code artifacts
    local workspace="$rdir/workspace"
    mkdir -p "$workspace"

    echo "════════════════════════════════════════════════════"
    echo "  [$pname] Run $n/$TARGET_RUNS — $task_id"
    echo "  $rdir"
    echo "  workspace: $workspace"
    echo "════════════════════════════════════════════════════"

    local t0
    t0=$(date +%s)

    case "$pname" in
      ORCHESTRATOR) run_orchestrator "$task_id" "$task_prompt" "$rdir" "$workspace" ;;
      SINGLE_SHOT)  run_single_shot "$task_prompt" "$rdir" "$workspace" ;;
      LADDER)       run_ladder "$tidx" "$rdir" "$workspace" ;;
    esac

    local t1 elapsed
    t1=$(date +%s)
    elapsed=$(( t1 - t0 ))

    # Write metadata FIRST (score.sh uses run-meta.json for elapsed fallback)
    cat > "$rdir/run-meta.json" <<-META
	{
	  "task_id": "$task_id",
	  "task_name": "$task_name",
	  "producer": "$pname",
	  "tool": "$TOOL",
	  "timestamp": "$ts",
	  "elapsed_seconds": $elapsed,
	  "budget_cap": $BUDGET_CAP,
	  "task_index": $tidx
	}
	META

    # Score (metadata-based metrics)
    bash "$SCORE_SCRIPT" "$rdir" 2>/dev/null || true

    # Rubric score (code-artifact completeness)
    if [ -f "$RUBRIC_RUNNER" ]; then
      python3 "$RUBRIC_RUNNER" "$workspace" "$TASKS_FILE" "$tidx" \
        > /dev/null 2>&1 || true
      # Copy rubric-score.json from workspace to run dir
      [ -f "$workspace/rubric-score.json" ] && cp "$workspace/rubric-score.json" "$rdir/"
    fi

    echo "  Done in ${elapsed}s"
    echo ""
    n=$(( n + 1 ))
  done
}

# ── dispatch ──────────────────────────────────────────────────
case "$PRODUCER" in
  ORCHESTRATOR) run_producer "ORCHESTRATOR" ;;
  SINGLE_SHOT)  run_producer "SINGLE_SHOT"  ;;
  LADDER)       run_producer "LADDER"       ;;
  ALL)
    run_producer "ORCHESTRATOR"
    run_producer "SINGLE_SHOT"
    run_producer "LADDER"
    ;;
  *)
    echo "ERROR: Unknown producer '$PRODUCER'. Use ORCHESTRATOR | SINGLE_SHOT | LADDER | ALL." >&2
    exit 1
    ;;
esac

echo "════════════════════════════════════════════════════"
echo "  All $PRODUCER runs complete."
echo "════════════════════════════════════════════════════"
echo ""
echo "Next:"
echo "  python3 benchmarks/harness/scoring/compute_ci.py  $RESULTS_DIR"
echo "  python3 benchmarks/harness/scoring/sampler_audit.py $RESULTS_DIR"
