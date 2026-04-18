#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# run-n.sh — Execute a benchmark N times and record per-run metrics
#
# Usage:
#   ./run-n.sh <benchmark-name> <N>
#
# Supported benchmarks (name maps to how the run is invoked):
#   demo-fast   — swarm demo demo-fast --yes --no-dashboard
#                 Cheapest; hello-world swarm, 2 steps, ~1 min.
#
# Per-run artifacts:
#   raw_data/<benchmark>/run-<i>/stdout.log
#   raw_data/<benchmark>/run-<i>/metrics.json   (copy of run's metrics.json)
#   raw_data/<benchmark>/run-<i>/cost-attribution.json
#
# Aggregate:
#   raw_data/<benchmark>/metrics.jsonl  — one JSON per run with:
#     { run_index, wall_clock_ms, exit_status,
#       completed_steps, total_steps, commit_count,
#       actual_premium_requests, estimated_premium_requests,
#       timestamp_start }
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BENCHMARK="${1:?Usage: run-n.sh <benchmark-name> <N>}"
N="${2:?Usage: run-n.sh <benchmark-name> <N>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$SCRIPT_DIR/raw_data/$BENCHMARK"
METRICS_FILE="$OUT_DIR/metrics.jsonl"

mkdir -p "$OUT_DIR"

# Start fresh metrics file per invocation. Append mode on the file is risky
# when the user restarts; instead we write a clean file and keep prior runs
# under their numbered subdirs.
: > "$METRICS_FILE"

invoke() {
  case "$1" in
    demo-fast)
      node "$REPO_ROOT/dist/src/cli.js" demo demo-fast --yes --no-dashboard
      ;;
    *)
      echo "ERROR: unsupported benchmark '$1'" >&2
      return 2
      ;;
  esac
}

extract_metrics() {
  # Inputs: run_index, stdout_log, start_ms, exit_status
  # Finds the run directory from the log and copies metrics/cost files.
  local idx="$1" stdout_log="$2" start_ms="$3" exit_status="$4"
  local run_out="$OUT_DIR/run-$idx"
  mkdir -p "$run_out"
  cp "$stdout_log" "$run_out/stdout.log"

  local run_dir
  run_dir=$(grep -oP 'Run Directory:\s*\K\S+' "$stdout_log" | head -1 || true)

  local completed_steps=0 total_steps=0 commit_count=0
  local actual_pr=0 estimated_pr=0

  if [ -n "$run_dir" ] && [ -f "$run_dir/metrics.json" ]; then
    cp "$run_dir/metrics.json" "$run_out/metrics.json"
    commit_count=$(jq -r '.commitCount // 0' "$run_dir/metrics.json")
  fi
  if [ -n "$run_dir" ] && [ -f "$run_dir/cost-attribution.json" ]; then
    cp "$run_dir/cost-attribution.json" "$run_out/cost-attribution.json"
    actual_pr=$(jq -r '.totalActualPremiumRequests // 0' "$run_dir/cost-attribution.json")
    estimated_pr=$(jq -r '.totalEstimatedPremiumRequests // 0' "$run_dir/cost-attribution.json")
    total_steps=$(jq -r '(.perStep // []) | length' "$run_dir/cost-attribution.json")
    completed_steps=$total_steps  # every perStep entry corresponds to a completed step
  fi

  local end_ms wall_ms
  end_ms=$(date +%s%3N)
  wall_ms=$(( end_ms - start_ms ))

  # Emit one JSON line
  python3 -c "
import json, sys
print(json.dumps({
  'run_index': $idx,
  'wall_clock_ms': $wall_ms,
  'exit_status': $exit_status,
  'completed_steps': $completed_steps,
  'total_steps': $total_steps,
  'commit_count': $commit_count,
  'actual_premium_requests': $actual_pr,
  'estimated_premium_requests': $estimated_pr,
  'timestamp_start_epoch_ms': $start_ms,
  'run_dir': '$run_dir'
}))" >> "$METRICS_FILE"
}

echo "==> Running $BENCHMARK × $N, artifacts in $OUT_DIR"

for i in $(seq 1 "$N"); do
  echo "[run-$i/$N] starting $BENCHMARK at $(date -Iseconds)"
  mkdir -p "$OUT_DIR/run-$i"
  log="$OUT_DIR/run-$i/stdout.log"
  start_ms=$(date +%s%3N)
  set +e
  invoke "$BENCHMARK" > "$log" 2>&1
  status=$?
  set -e
  extract_metrics "$i" "$log" "$start_ms" "$status"
  echo "[run-$i/$N] exit=$status"
done

echo "==> Done. metrics.jsonl:"
cat "$METRICS_FILE"
