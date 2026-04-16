#!/usr/bin/env bash
# SWE-bench evaluation runner — one-command entry point.
#
# Usage:
#   ./run-eval.sh                    # orchestrator mode, 10 tasks
#   BASELINE_MODE=true ./run-eval.sh # baseline agent comparison
#   SWEBENCH_SUBSET_SIZE=50 ./run-eval.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is required. Install from https://docs.docker.com/get-docker/"
  exit 1
fi

echo "=== SWE-bench Evaluation ==="
echo "  Mode:    ${BASELINE_MODE:-orchestrator}"
echo "  Tool:    ${SWARM_TOOL:-claude-code}"
echo "  Subset:  ${SWEBENCH_SUBSET_SIZE:-10} tasks"
echo ""

docker compose up --build --abort-on-container-exit

echo ""
echo "=== Results ==="
ls -la results/eval-*.json 2>/dev/null || echo "(no results yet)"
