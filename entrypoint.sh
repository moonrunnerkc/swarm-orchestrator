#!/bin/bash
set -euo pipefail

GOAL="${INPUT_GOAL:-}"
CONTRACT_ONLY="${INPUT_CONTRACT_ONLY:-false}"

CMD=("node" "/app/dist/src/cli.js")

# contract-only short-circuits the action: compile the goal to a contract
# and stop. The contract directory under .swarm/contracts/ is the artifact.
if [ "$CONTRACT_ONLY" = "true" ]; then
  if [ -z "$GOAL" ]; then
    echo "Error: contract-only=true requires a goal input"
    exit 1
  fi
  CMD+=("v8" "compile" "$GOAL" "--yes" "--no-editor")
elif [ -n "$GOAL" ]; then
  CMD+=("run" "--goal" "$GOAL")
else
  echo "Error: goal must be provided"
  exit 1
fi

echo "Running swarm orchestrator (mode: ${CMD[2]:-unknown})"

"${CMD[@]}"

if [ -f "/tmp/swarm-result.json" ]; then
  echo "result=$(cat /tmp/swarm-result.json)" >> "$GITHUB_OUTPUT"
fi

REDACT_KEYS=(
  "ANTHROPIC_API_KEY"
  "OPENAI_API_KEY"
  "GITHUB_TOKEN"
)

for key_name in "${REDACT_KEYS[@]}"; do
  key_value="${!key_name:-}"
  if [ -n "$key_value" ]; then
    find /tmp -type f -print0 2>/dev/null \
      | xargs -0 perl -pi -e "s/\Q${key_value}\E/[REDACTED:${key_name}]/g" 2>/dev/null \
      || true
  fi
done
