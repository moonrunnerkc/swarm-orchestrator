#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# score.sh — Automated benchmark scoring for swarm-orchestrator
#
# Extracts objective metrics from a completed run directory.
# No subjective rubrics. No human judgment.
#
# Usage:
#   ./score.sh <run-directory>
#   ./score.sh ./runs/swarm-2026-04-09T23-55-49-420Z
#
# Output: JSON to stdout + <run-directory>/benchmark-score.json
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${1:?Usage: score.sh <run-directory>}"

if [ ! -d "$RUN_DIR" ]; then
  echo "ERROR: Run directory not found: $RUN_DIR" >&2
  exit 1
fi

# ── Helper: safe jq extraction ──
jq_or_null() {
  local file="$1" query="$2"
  if [ -f "$file" ]; then
    jq -r "$query // null" "$file" 2>/dev/null || echo "null"
  else
    echo "null"
  fi
}

# ──────────────────────────────────────────────────────────────
# Metric 1: Tests passing (%)
# ──────────────────────────────────────────────────────────────
METRICS_FILE="$RUN_DIR/metrics.json"
TESTS_PASS=$(jq_or_null "$METRICS_FILE" '.testsPassing // .tests_passing')
TESTS_TOTAL=$(jq_or_null "$METRICS_FILE" '.testsTotal // .tests_total')

if [ "$TESTS_PASS" != "null" ] && [ "$TESTS_TOTAL" != "null" ] && [ "$TESTS_TOTAL" != "0" ]; then
  TESTS_PCT=$(echo "scale=2; $TESTS_PASS * 100 / $TESTS_TOTAL" | bc)
else
  TESTS_PCT="null"
fi

# ──────────────────────────────────────────────────────────────
# Metric 2: Test coverage (%)
# ──────────────────────────────────────────────────────────────
COVERAGE_PCT="null"
# Check for c8/nyc/istanbul coverage
for cov_file in "$RUN_DIR/coverage-summary.json" "$RUN_DIR/coverage/coverage-summary.json"; do
  if [ -f "$cov_file" ]; then
    COVERAGE_PCT=$(jq_or_null "$cov_file" '.total.lines.pct // .total.statements.pct')
    break
  fi
done

# ──────────────────────────────────────────────────────────────
# Metric 3: Security scan results (SARIF issue count)
# ──────────────────────────────────────────────────────────────
SARIF_ISSUES="null"
for sarif_file in "$RUN_DIR/quality-gates.sarif" "$RUN_DIR/../quality-gates.sarif"; do
  if [ -f "$sarif_file" ]; then
    SARIF_ISSUES=$(jq '[.runs[].results[]] | length' "$sarif_file" 2>/dev/null || echo "null")
    break
  fi
done

# Also check quality-gates.json for issue counts (may be in subdirectory)
QG_FILE="$RUN_DIR/quality-gates.json"
[ ! -f "$QG_FILE" ] && QG_FILE="$RUN_DIR/quality-gates/quality-gates.json"
if [ -f "$QG_FILE" ]; then
  QG_TOTAL_ISSUES=$(jq '[.results[].issues[]] | length' "$QG_FILE" 2>/dev/null || echo "null")
  QG_PASSED=$(jq_or_null "$QG_FILE" '.passed')
else
  QG_TOTAL_ISSUES="null"
  QG_PASSED="null"
fi

# ──────────────────────────────────────────────────────────────
# Metric 4: Cost attribution
# ──────────────────────────────────────────────────────────────
COST_FILE="$RUN_DIR/cost-attribution.json"
TOTAL_PREMIUM_REQUESTS=$(jq_or_null "$COST_FILE" \
  'if type == "array" then [.[].actualPremiumRequests // .[].actual_premium_requests // 0] | add
   elif type == "object" then .totalActualPremiumRequests // .totalPremiumRequests // .total_premium_requests // 0
   else 0 end')
TOTAL_COST_ESTIMATE=$(jq_or_null "$COST_FILE" \
  'if type == "array" then [.[].estimatedPremiumRequests // .[].estimated_premium_requests // 0] | add
   elif type == "object" then .totalEstimatedPremiumRequests // .total_estimated // 0
   else 0 end')

# ──────────────────────────────────────────────────────────────
# Metric 5: Wall-clock time derived from metrics.json timestamps
# D9: Every wall-clock value must come from recorded timestamps.
#     No external-stopwatch values allowed.
# ──────────────────────────────────────────────────────────────
SESSION_FILE="$RUN_DIR/session-state.json"
WALL_CLOCK_MS=$(jq_or_null "$METRICS_FILE" '.totalTimeMs')
START_TS=$(jq_or_null "$METRICS_FILE" '.startTime')
END_TS=$(jq_or_null "$METRICS_FILE" '.endTime')

if [ "$WALL_CLOCK_MS" = "null" ] && [ "$START_TS" != "null" ] && [ "$END_TS" != "null" ]; then
  # Derive from timestamps if totalTimeMs missing
  START_EPOCH=$(date -d "$START_TS" +%s%N 2>/dev/null | head -c 13 || echo "null")
  END_EPOCH=$(date -d "$END_TS" +%s%N 2>/dev/null | head -c 13 || echo "null")
  if [ "$START_EPOCH" != "null" ] && [ "$END_EPOCH" != "null" ]; then
    WALL_CLOCK_MS=$((END_EPOCH - START_EPOCH))
  fi
fi

if [ "$WALL_CLOCK_MS" != "null" ]; then
  WALL_CLOCK_SEC=$(echo "scale=2; $WALL_CLOCK_MS / 1000" | bc)
else
  # Fallback: check run-meta.json elapsed_seconds (set by harness stopwatch)
  RUN_META_FILE="$RUN_DIR/run-meta.json"
  ELAPSED_FROM_META=$(jq_or_null "$RUN_META_FILE" '.elapsed_seconds')
  if [ "$ELAPSED_FROM_META" != "null" ] && [ "$ELAPSED_FROM_META" != "0" ]; then
    WALL_CLOCK_SEC="$ELAPSED_FROM_META"
  else
    echo "WARNING: No wall-clock data in $RUN_DIR (missing metrics.json timestamps)" >&2
    WALL_CLOCK_SEC="null"
  fi
fi

# ──────────────────────────────────────────────────────────────
# Metric 6: Repair-loop iterations
# ──────────────────────────────────────────────────────────────
REPAIR_ITERATIONS=$(jq_or_null "$SESSION_FILE" \
  '[.steps[]? | select(.repair == true or .isRepair == true or .type == "repair")] | length')
# Also check graph.steps in session-state
if [ "$REPAIR_ITERATIONS" = "null" ] || [ "$REPAIR_ITERATIONS" = "0" ]; then
  REPAIR_ITERATIONS=$(jq_or_null "$SESSION_FILE" \
    '[.graph.steps[]? | select(.repair == true or .isRepair == true or .type == "repair")] | length')
fi
RETRY_COUNT=$(jq_or_null "$SESSION_FILE" \
  '[.steps[]? | .retries // .retry_count // 0] | add')

# ── Extra: extract run metadata from session-state ──
RUN_STATUS=$(jq_or_null "$SESSION_FILE" '.status')
STEP_COUNT=$(jq_or_null "$SESSION_FILE" '.metrics.stepCount // .graph.steps | length')
VERIFICATIONS_PASSED=$(jq_or_null "$SESSION_FILE" '.metrics.verificationsPassed')
VERIFICATIONS_FAILED=$(jq_or_null "$SESSION_FILE" '.metrics.verificationsFailed')

# ──────────────────────────────────────────────────────────────
# Assemble output
# ──────────────────────────────────────────────────────────────
SCORE_JSON=$(cat <<EOF
{
  "run_directory": "$RUN_DIR",
  "scored_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "metrics": {
    "tests_passing_pct": $TESTS_PCT,
    "tests_passing": $TESTS_PASS,
    "tests_total": $TESTS_TOTAL,
    "test_coverage_pct": $COVERAGE_PCT,
    "security_scan_sarif_issues": $SARIF_ISSUES,
    "quality_gate_issues": $QG_TOTAL_ISSUES,
    "quality_gates_passed": $QG_PASSED,
    "premium_requests_actual": $TOTAL_PREMIUM_REQUESTS,
    "premium_requests_estimated": $TOTAL_COST_ESTIMATE,
    "wall_clock_seconds": $WALL_CLOCK_SEC,
    "repair_iterations": $REPAIR_ITERATIONS,
    "retry_count": $RETRY_COUNT,
    "run_status": "$RUN_STATUS",
    "step_count": $STEP_COUNT,
    "verifications_passed": $VERIFICATIONS_PASSED,
    "verifications_failed": $VERIFICATIONS_FAILED
  }
}
EOF
)

# Write to file
echo "$SCORE_JSON" | jq '.' > "$RUN_DIR/benchmark-score.json"

# ──────────────────────────────────────────────────────────────
# D12: Run label derivation (see run-states.md)
#
# For ORCHESTRATOR runs: session-state.json is the primary signal.
# For SINGLE_SHOT / LADDER: no session-state.json exists —
#   derive label from cost-attribution.json and workspace contents.
# ──────────────────────────────────────────────────────────────
# Read budget_cap from run-meta.json (set by harness); default 30
RUN_META_FILE_LABEL="$RUN_DIR/run-meta.json"
BUDGET_CAP=$(jq_or_null "$RUN_META_FILE_LABEL" '.budget_cap')
if [ "$BUDGET_CAP" = "null" ] || [ -z "$BUDGET_CAP" ]; then
  BUDGET_CAP=30
fi
SESSION_PRESENT=true
if [ ! -f "$SESSION_FILE" ]; then
  SESSION_PRESENT=false
fi

# Check if code artifacts were produced (workspace dir has files)
HAS_WORKSPACE=false
if [ -d "$RUN_DIR/workspace" ]; then
  WS_FILE_COUNT=$(find "$RUN_DIR/workspace" -maxdepth 2 -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.json" -not -name ".rubric_task_meta.json" -not -name "rubric-score.json" 2>/dev/null | head -5 | wc -l)
  [ "$WS_FILE_COUNT" -gt 0 ] && HAS_WORKSPACE=true
fi

# Derive label
if [ "$SESSION_PRESENT" = "false" ] && [ "$HAS_WORKSPACE" = "false" ]; then
  # No session state AND no code produced — genuine infrastructure failure
  RUN_LABEL="INFRASTRUCTURE_FAILURE"
elif [ "$SESSION_PRESENT" = "false" ] && [ "$HAS_WORKSPACE" = "true" ]; then
  # Baseline producer (SINGLE_SHOT or LADDER) — no session-state expected
  if [ "$TOTAL_PREMIUM_REQUESTS" != "null" ] && [ "$TOTAL_PREMIUM_REQUESTS" -ge "$BUDGET_CAP" ] 2>/dev/null; then
    RUN_LABEL="BUDGET_EXHAUSTED"
  else
    RUN_LABEL="COMPLETED"
  fi
elif [ "$RUN_STATUS" = "completed" ] && [ "$QG_PASSED" = "true" ]; then
  RUN_LABEL="COMPLETED"
elif [ "$TOTAL_PREMIUM_REQUESTS" != "null" ] && [ "$TOTAL_PREMIUM_REQUESTS" -ge "$BUDGET_CAP" ] 2>/dev/null; then
  RUN_LABEL="BUDGET_EXHAUSTED"
elif [ "$RUN_STATUS" = "failed" ]; then
  RUN_LABEL="VERIFICATION_FAILED"
else
  RUN_LABEL="BUDGET_EXHAUSTED"
fi

LABEL_JSON=$(cat <<LEOF
{
  "run_id": "$(basename "$RUN_DIR")",
  "label": "$RUN_LABEL",
  "cost": $TOTAL_PREMIUM_REQUESTS,
  "source_signals": {
    "session_state_present": $SESSION_PRESENT,
    "session_state_status": "$RUN_STATUS",
    "premium_requests": $TOTAL_PREMIUM_REQUESTS,
    "budget_cap": $BUDGET_CAP
  }
}
LEOF
)

echo "$LABEL_JSON" | jq '.' > "$RUN_DIR/label.json"

# Output to stdout
echo "$SCORE_JSON" | jq '.'
