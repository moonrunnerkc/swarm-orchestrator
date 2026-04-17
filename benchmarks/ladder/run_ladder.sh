#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# run_ladder.sh — Deterministic iterative-prompt ladder baseline
#
# For a given task, iterates through ladder_prompts from the task
# definition, re-scoring the rubric after each step. Stops when:
#   1. All applicable rubric attributes are present, OR
#   2. The budget cap (premium request count) is reached, OR
#   3. All ladder prompts have been exhausted.
#
# After exhausting explicit ladder prompts, the script generates
# repair prompts targeting the first missing attribute, up to
# the budget cap.
#
# Arguments:
#   $1 — path to tasks JSON file
#   $2 — task index (0-based)
#   $3 — run output directory
#   $4 — budget cap (max premium requests)
#
# Called by: run_fresh.sh (LADDER producer)
# ──────────────────────────────────────────────────────────────
set -euo pipefail

TASKS_FILE="$1"
TASK_INDEX="$2"
RUN_DIR="$3"
BUDGET_CAP="${4:-30}"
WORKSPACE="${5:-$RUN_DIR/workspace}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUBRIC_RUNNER="$SCRIPT_DIR/../harness/scoring/rubric_runner.py"

mkdir -p "$RUN_DIR"
mkdir -p "$WORKSPACE"

# ── Extract task data ─────────────────────────────────────────
TASK_JSON=$(python3 -c "
import json, sys
tasks = json.load(open('$TASKS_FILE'))
t = tasks[int('$TASK_INDEX') % len(tasks)]
out = {
  'id': t.get('id', 'unknown'),
  'prompt': t.get('prompt', t.get('goal', '')),
  'ladder_prompts': t.get('ladder_prompts', []),
  'applicable_attributes': t.get('applicable_attributes', [])
}
print(json.dumps(out))
")

TASK_ID=$(echo "$TASK_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'])")

# Write ladder prompts to a temp file for line-by-line reading
PROMPTS_FILE=$(mktemp)
trap 'rm -f "$PROMPTS_FILE"' EXIT

echo "$TASK_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
prompts = d.get('ladder_prompts', [])
if not prompts:
    prompts = [d['prompt']]
for p in prompts:
    print(p)
" > "$PROMPTS_FILE"

TOTAL_ATTRS=$(echo "$TASK_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['applicable_attributes']))")

# ── Ladder loop ───────────────────────────────────────────────
request_count=0
step=0

echo "[$TASK_ID] Starting ladder — $TOTAL_ATTRS applicable attributes, budget=$BUDGET_CAP"

# Phase 1: Explicit ladder prompts
while IFS= read -r prompt; do
  [ -z "$prompt" ] && continue
  if [ "$request_count" -ge "$BUDGET_CAP" ]; then
    echo "  Budget exhausted at step $step ($request_count requests)"
    break
  fi

  step=$((step + 1))
  request_count=$((request_count + 1))
  echo "  Step $step (request $request_count): ${prompt:0:80}..."

  (cd "$WORKSPACE" && claude --dangerously-skip-permissions -p "$prompt" \
    >> "$RUN_DIR/ladder_stdout.txt" 2>&1) || true

  # Re-score rubric after this step
  if [ -f "$RUBRIC_RUNNER" ]; then
    python3 "$RUBRIC_RUNNER" "$WORKSPACE" "$TASKS_FILE" "$TASK_INDEX" \
      > "$RUN_DIR/rubric-step-${step}.json" 2>/dev/null || true

    # Check if all attributes are present
    local_score=$(python3 -c "
import json
try:
    d = json.load(open('$RUN_DIR/rubric-step-${step}.json'))
    print(d.get('rubric_score', 0))
except: print(0)
" 2>/dev/null || echo "0")
    echo "    Score after step $step: $local_score"

    if [ "$local_score" = "1.0" ] || [ "$local_score" = "1" ]; then
      echo "  All attributes present — stopping early"
      break
    fi
  fi
done < "$PROMPTS_FILE"

# Phase 2: Repair prompts for missing attributes
if [ "$request_count" -lt "$BUDGET_CAP" ] && [ -f "$RUBRIC_RUNNER" ]; then
  echo "  Entering repair phase..."

  while [ "$request_count" -lt "$BUDGET_CAP" ]; do
    # Find first missing attribute
    missing_attr=$(python3 -c "
import json
try:
    d = json.load(open('$RUN_DIR/rubric-step-${step}.json'))
    for r in d.get('results', []):
        if r.get('applicable') and not r.get('present'):
            print(r['attribute_id'])
            break
except: pass
" 2>/dev/null || true)

    [ -z "$missing_attr" ] && break

    step=$((step + 1))
    request_count=$((request_count + 1))
    local repair_prompt="The project is missing the '$missing_attr' attribute. Please add it now. Check the rubric for what this means and implement it."
    echo "  Repair step $step (request $request_count): fix $missing_attr"

    (cd "$WORKSPACE" && claude --dangerously-skip-permissions -p "$repair_prompt" \
      >> "$RUN_DIR/ladder_stdout.txt" 2>&1) || true

    python3 "$RUBRIC_RUNNER" "$WORKSPACE" "$TASKS_FILE" "$TASK_INDEX" \
      > "$RUN_DIR/rubric-step-${step}.json" 2>/dev/null || true

    local_score=$(python3 -c "
import json
try:
    d = json.load(open('$RUN_DIR/rubric-step-${step}.json'))
    print(d.get('rubric_score', 0))
except: print(0)
" 2>/dev/null || echo "0")
    echo "    Score after repair step $step: $local_score"

    if [ "$local_score" = "1.0" ] || [ "$local_score" = "1" ]; then
      echo "  All attributes present — stopping"
      break
    fi
  done
fi

# ── Final rubric score ────────────────────────────────────────
if [ -f "$RUBRIC_RUNNER" ]; then
  python3 "$RUBRIC_RUNNER" "$WORKSPACE" "$TASKS_FILE" "$TASK_INDEX" \
    > "$RUN_DIR/rubric-score.json" 2>/dev/null || true
  # Also copy into workspace for consistency
  [ -f "$WORKSPACE/rubric-score.json" ] && cp "$WORKSPACE/rubric-score.json" "$RUN_DIR/" 2>/dev/null || true
fi

# ── Cost attribution ──────────────────────────────────────────
cat > "$RUN_DIR/cost-attribution.json" <<COST
{
  "totalEstimatedPremiumRequests": $request_count,
  "totalActualPremiumRequests": $request_count,
  "estimateAccuracy": 1.0,
  "modelUsed": "claude-sonnet-4",
  "modelMultiplier": 1,
  "overageTriggered": false,
  "budgetCap": $BUDGET_CAP,
  "ladderSteps": $step,
  "perStep": []
}
COST

echo "[$TASK_ID] Ladder complete: $request_count requests, $step steps"
