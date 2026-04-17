#!/usr/bin/env bash
# SWE-bench evaluation runner — one-command entry point.
#
# Usage:
#   ./run-eval.sh                                             # orchestrator, 5 tasks, Docker
#   ./run-eval.sh --docker-only --tasks 5 --timeout 900       # explicit Docker, 5 tasks
#   ./run-eval.sh --baseline-mode true                        # baseline agent comparison
#   SWEBENCH_SUBSET_SIZE=50 ./run-eval.sh                     # env-var override
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Parse CLI flags (override env vars) ─────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker-only)   shift ;;                      # Docker is the only mode now
    --tasks)         export SWEBENCH_SUBSET_SIZE="$2"; shift 2 ;;
    --timeout)       export TASK_TIMEOUT_SECONDS="$2"; shift 2 ;;
    --baseline-mode) export BASELINE_MODE="$2"; shift 2 ;;
    --model)         export SWARM_MODEL="$2"; shift 2 ;;
    --tool)          export SWARM_TOOL="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is required. Install from https://docs.docker.com/get-docker/"
  exit 1
fi

echo "=== SWE-bench Evaluation (Docker) ==="
echo "  Mode:    ${BASELINE_MODE:-orchestrator}"
echo "  Tool:    ${SWARM_TOOL:-claude-code}"
echo "  Model:   ${SWARM_MODEL:-claude-sonnet-4}"
echo "  Subset:  ${SWEBENCH_SUBSET_SIZE:-5} tasks"
echo "  Timeout: ${TASK_TIMEOUT_SECONDS:-900}s per task"
echo ""

docker compose up --build --abort-on-container-exit

echo ""
echo "=== Results ==="
ls -lt results/eval-*.json 2>/dev/null | head -5 || echo "(no results yet)"
