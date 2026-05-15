#!/bin/bash
set -euo pipefail

# ── Inputs ────────────────────────────────────────────────────────────────
GOAL="${INPUT_GOAL:-}"
CONTRACT_PATH="${INPUT_CONTRACT_PATH:-}"
CONTRACT_ONLY="${INPUT_CONTRACT_ONLY:-false}"
CONTRACT_FILE="${INPUT_CONTRACT_FILE:-}"
CONTRACT_MODULE="${INPUT_CONTRACT_MODULE:-}"
EXTRACTOR="${INPUT_EXTRACTOR:-}"
SESSION="${INPUT_SESSION:-}"
MODEL="${INPUT_MODEL:-}"
LOCAL_BACKEND="${INPUT_LOCAL_BACKEND:-}"
LOCAL_BASE_URL="${INPUT_LOCAL_BASE_URL:-}"
LOCAL_MODEL_EXTRACTOR="${INPUT_LOCAL_MODEL_EXTRACTOR:-}"
LOCAL_MODEL_SESSION="${INPUT_LOCAL_MODEL_SESSION:-}"
LOCAL_GRAMMAR="${INPUT_LOCAL_GRAMMAR:-}"
EXTERNAL_PATCHES_QUEUE="${INPUT_EXTERNAL_PATCHES_QUEUE:-}"
EXTERNAL_PATCHES_DIR="${INPUT_EXTERNAL_PATCHES_DIR:-}"
FALSIFIERS="${INPUT_FALSIFIERS:-}"
MODE="${INPUT_MODE:-}"
CANDIDATES="${INPUT_CANDIDATES:-}"
MAX_OBLIGATIONS="${INPUT_MAX_OBLIGATIONS:-}"
COST_CAP="${INPUT_COST_CAP:-}"
REPO_ROOT="${INPUT_REPO_ROOT:-}"
WORKING_DIRECTORY="${INPUT_WORKING_DIRECTORY:-}"
RESULT_PATH="${INPUT_RESULT_PATH:-/tmp/swarm-result.json}"
EXTRA_ARGS="${INPUT_EXTRA_ARGS:-}"

# ── Validate mode selection ───────────────────────────────────────────────
if [ -n "$GOAL" ] && [ -n "$CONTRACT_PATH" ]; then
  echo "Error: 'goal' and 'contract-path' are mutually exclusive." >&2
  exit 1
fi

if [ -z "$GOAL" ] && [ -z "$CONTRACT_PATH" ]; then
  echo "Error: provide either 'goal' or 'contract-path'." >&2
  exit 1
fi

if [ -n "$CONTRACT_PATH" ] && [ "$CONTRACT_ONLY" = "true" ]; then
  echo "Error: 'contract-only=true' requires 'goal', not 'contract-path'." >&2
  exit 1
fi

# ── Switch to working directory before invoking the CLI ───────────────────
if [ -n "$WORKING_DIRECTORY" ]; then
  cd "$WORKING_DIRECTORY"
fi

# ── Build argv ────────────────────────────────────────────────────────────
CMD=("node" "/app/dist/src/cli.js")

if [ -n "$CONTRACT_PATH" ]; then
  CMD+=("run" "$CONTRACT_PATH")
elif [ "$CONTRACT_ONLY" = "true" ]; then
  CMD+=("compile" "$GOAL" "--yes" "--no-editor")
else
  CMD+=("run" "--goal" "$GOAL")
fi

# Append `--<flag> <value>` only when value is non-empty.
push() {
  if [ -n "${2:-}" ]; then
    CMD+=("$1" "$2")
  fi
}

# Compile-relevant flags (only meaningful when the run wrapper invokes compile,
# or when contract-only=true).
if [ -z "$CONTRACT_PATH" ]; then
  push "--extractor" "$EXTRACTOR"
  push "--contract-file" "$CONTRACT_FILE"
  push "--contract-module" "$CONTRACT_MODULE"
fi

# Run-relevant flags. When contract-only=true the CLI is the `compile`
# subcommand and doesn't accept these, so they are skipped.
if [ "$CONTRACT_ONLY" != "true" ]; then
  push "--session" "$SESSION"
  push "--external-patches-queue" "$EXTERNAL_PATCHES_QUEUE"
  push "--external-patches-dir" "$EXTERNAL_PATCHES_DIR"
  push "--falsifiers" "$FALSIFIERS"
  push "--mode" "$MODE"
  push "--candidates" "$CANDIDATES"
  push "--max-obligations" "$MAX_OBLIGATIONS"
  push "--cost-cap" "$COST_CAP"
  push "--result" "$RESULT_PATH"
fi

# Flags accepted by both compile and run.
push "--model" "$MODEL"
push "--local-backend" "$LOCAL_BACKEND"
push "--local-base-url" "$LOCAL_BASE_URL"
push "--local-model-extractor" "$LOCAL_MODEL_EXTRACTOR"
push "--local-model-session" "$LOCAL_MODEL_SESSION"
push "--local-grammar" "$LOCAL_GRAMMAR"
push "--repo-root" "$REPO_ROOT"

# Append raw extra-args. Shell-split with quote awareness; an unbalanced
# quote raises here before the CLI is invoked so the user gets a clear
# parse error instead of a cryptic CLI rejection.
if [ -n "$EXTRA_ARGS" ]; then
  # Shell-split with quote awareness: `xargs -n1` respects single and
  # double quotes and raises on unbalanced quoting. Iterate via
  # `while read` for portability across bash versions that lack mapfile.
  EXTRA_ARRAY=()
  while IFS= read -r line; do
    EXTRA_ARRAY+=("$line")
  done < <(printf '%s' "$EXTRA_ARGS" | xargs -n1 printf '%s\n')
  if [ ${#EXTRA_ARRAY[@]} -gt 0 ]; then
    CMD+=("${EXTRA_ARRAY[@]}")
  fi
fi

echo "swarm-orchestrator: ${CMD[*]}"

"${CMD[@]}"

# ── Emit run-result JSON as the `result` step output ──────────────────────
if [ -n "${GITHUB_OUTPUT:-}" ] && [ -f "$RESULT_PATH" ]; then
  {
    echo "result<<__SWARM_RESULT_EOF__"
    cat "$RESULT_PATH"
    echo "__SWARM_RESULT_EOF__"
  } >> "$GITHUB_OUTPUT"
fi

# ── Redact known secret values from any temp files ────────────────────────
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
