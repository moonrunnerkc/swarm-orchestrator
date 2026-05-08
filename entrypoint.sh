#!/bin/bash
set -euo pipefail

GOAL="${INPUT_GOAL:-}"
TOOL="${INPUT_TOOL:-copilot}"
MODEL="${INPUT_MODEL:-}"
PLAN="${INPUT_PLAN:-}"
RECIPE="${INPUT_RECIPE:-}"
MAX_RETRIES="${INPUT_MAX_RETRIES:-3}"
PR="${INPUT_PR:-review}"
SARIF="${INPUT_SARIF:-false}"
CONTRACT_ONLY="${INPUT_CONTRACT_ONLY:-false}"
COST_CAP="${INPUT_COST_CAP:-}"

# Build command as safe array; no string concatenation, no eval
CMD=("node" "/app/dist/src/cli.js")

# v8 contract-only short-circuits the action: compile the goal to a contract
# and stop. The contract directory under .swarm/contracts/ is the artifact.
# The behavior is documented at v8-implementation-guide.md §12 (line 290).
if [ "$CONTRACT_ONLY" = "true" ]; then
  if [ -z "$GOAL" ]; then
    echo "Error: contract-only=true requires a goal input"
    exit 1
  fi
  CMD+=("v8" "compile" "$GOAL" "--yes" "--no-editor")
elif [ -n "$RECIPE" ]; then
  CMD+=("use" "$RECIPE" "--tool" "$TOOL" "--max-retries" "$MAX_RETRIES" "--pr" "$PR")
elif [ -n "$PLAN" ]; then
  CMD+=("swarm" "$PLAN" "--tool" "$TOOL" "--max-retries" "$MAX_RETRIES" "--pr" "$PR")
elif [ -n "$GOAL" ]; then
  CMD+=("run" "--goal" "$GOAL" "--tool" "$TOOL" "--max-retries" "$MAX_RETRIES" "--pr" "$PR")
else
  echo "Error: one of goal, plan, or recipe must be provided"
  exit 1
fi

if [ -n "$MODEL" ]; then
  CMD+=("--model" "$MODEL")
fi

# v8 hard cost ceiling. Forwarded to whichever subcommand the action is
# dispatching to; v8 run/resume parse it and abort the run when cumulative
# estimated spend exceeds the cap. The legacy v6 path ignores it.
if [ -n "$COST_CAP" ]; then
  CMD+=("--cost-cap" "$COST_CAP")
fi

# Log mode without echoing raw user input (prevents secret leaks via goal text)
echo "Running swarm orchestrator (mode: ${CMD[2]:-unknown})"

# Array dispatch: each element passes as a separate execve argument.
# No shell re-parsing, no injection vector.
"${CMD[@]}"

# ── SARIF output for GitHub code scanning ──
if [ "$SARIF" = "true" ]; then
  SARIF_PATH="/tmp/swarm-gates.sarif"
  node /app/dist/src/cli.js gates . --sarif "$SARIF_PATH" || true
  if [ -f "$SARIF_PATH" ]; then
    echo "sarif-path=${SARIF_PATH}" >> "$GITHUB_OUTPUT"
  fi
fi

# ── Output capture (original contract preserved) ──
if [ -f "/tmp/swarm-result.json" ]; then
  echo "result=$(cat /tmp/swarm-result.json)" >> "$GITHUB_OUTPUT"
fi

if [ -f "/tmp/swarm-plan.json" ]; then
  echo "plan-path=/tmp/swarm-plan.json" >> "$GITHUB_OUTPUT"
fi

if [ -f "/tmp/swarm-pr-url.txt" ]; then
  echo "pr-url=$(cat /tmp/swarm-pr-url.txt)" >> "$GITHUB_OUTPUT"
fi

# ── Deterministic artifact redaction ──
# Perl \Q..\E treats the secret as a literal string, handling +, /, &,
# and all other metacharacters that appear in API keys.
REDACT_KEYS=(
  "ANTHROPIC_API_KEY"
  "OPENAI_API_KEY"
  "GITHUB_TOKEN"
  "COPILOT_TOKEN"
  "GOOGLE_APPLICATION_CREDENTIALS"
)

for key_name in "${REDACT_KEYS[@]}"; do
  key_value="${!key_name:-}"
  if [ -n "$key_value" ]; then
    find /tmp runs/ -type f -print0 2>/dev/null \
      | xargs -0 perl -pi -e "s/\Q${key_value}\E/[REDACTED:${key_name}]/g" 2>/dev/null \
      || true
  fi
done
