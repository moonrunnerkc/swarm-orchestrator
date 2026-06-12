#!/bin/bash
set -euo pipefail

# ── Secret redaction on exit ──────────────────────────────────────────────
# Trap-driven so it fires from both the audit-mode and legacy orchestrator
# paths and even on an unexpected exit. Covers /tmp scratch files, the
# .swarm/ run artifacts, and any GITHUB_OUTPUT file that buffered values
# before the harness consumed it. The exit code is preserved so callers
# see the underlying CLI's status, not the trap's.
redact_known_secrets() {
  local rc=$?
  local redact_keys=("ANTHROPIC_API_KEY" "OPENAI_API_KEY" "GITHUB_TOKEN" "NPM_TOKEN")
  local key_name key_value
  local -a scrub_targets=("/tmp")
  if [ -d ".swarm" ]; then scrub_targets+=(".swarm"); fi
  if [ -n "${GITHUB_OUTPUT:-}" ] && [ -f "${GITHUB_OUTPUT}" ]; then
    scrub_targets+=("${GITHUB_OUTPUT}")
  fi
  for key_name in "${redact_keys[@]}"; do
    key_value="${!key_name:-}"
    if [ -n "$key_value" ]; then
      find "${scrub_targets[@]}" -type f -print0 2>/dev/null \
        | xargs -0 perl -pi -e "s/\Q${key_value}\E/[REDACTED:${key_name}]/g" 2>/dev/null
    fi
  done
  return $rc
}
trap redact_known_secrets EXIT

# ── Inputs ────────────────────────────────────────────────────────────────
AUDIT_MODE="${INPUT_AUDIT_MODE:-false}"
AUDIT_PR="${INPUT_PR:-}"
AUDIT_DIFF_FILE="${INPUT_DIFF_FILE:-}"
AUDIT_EMIT_AIBOM="${INPUT_EMIT_AIBOM:-}"
AUDIT_COMMENT="${INPUT_AUDIT_COMMENT:-true}"
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

# ── Audit mode short-circuits the legacy v8 orchestrator path ─────────────
if [ "$AUDIT_MODE" = "true" ]; then
  if [ -n "$WORKING_DIRECTORY" ]; then
    cd "$WORKING_DIRECTORY"
  fi

  # The image runs as a non-root user, and GitHub mounts the workspace owned
  # by the host runner uid, so cwd may not be writable from inside the
  # container. The audit only reads its inputs; its artifacts (.swarm/ledger,
  # .swarm/aibom) are cwd-relative. When cwd is unwritable, resolve the diff
  # path, keep repo-root pointed at the workspace so .swarm/audit-config.yaml
  # is still honored, and run from a writable scratch dir instead of dying on
  # the first mkdir.
  if ! touch .swarm-write-probe 2>/dev/null; then
    if [ -n "$AUDIT_DIFF_FILE" ] && [ -f "$AUDIT_DIFF_FILE" ]; then
      AUDIT_DIFF_FILE="$(cd "$(dirname "$AUDIT_DIFF_FILE")" && pwd)/$(basename "$AUDIT_DIFF_FILE")"
    fi
    if [ -z "$REPO_ROOT" ]; then
      REPO_ROOT="$(pwd)"
    fi
    SCRATCH="${RUNNER_TEMP:-/tmp}/swarm-audit-scratch"
    mkdir -p "$SCRATCH"
    cd "$SCRATCH"
    echo "swarm-audit: workspace is not writable from the container user; artifacts under ${SCRATCH}/.swarm"
  else
    rm -f .swarm-write-probe
  fi

  AUDIT_CMD=("node" "/app/dist/src/cli.js" "audit")

  if [ -n "$AUDIT_DIFF_FILE" ]; then
    AUDIT_CMD+=("--diff-file" "$AUDIT_DIFF_FILE")
  elif [ -n "$AUDIT_PR" ]; then
    if [[ "$AUDIT_PR" =~ ^[0-9]+$ ]] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
      AUDIT_CMD+=("${GITHUB_REPOSITORY}#${AUDIT_PR}")
    else
      AUDIT_CMD+=("$AUDIT_PR")
    fi
  elif [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH}" ]; then
    # Pass GITHUB_EVENT_PATH via the child env instead of splicing it into
    # the -e string; an event-path value with a single quote would otherwise
    # close the require() literal and inject the rest as JavaScript.
    INFERRED_PR=$(SWARM_EVT_PATH="${GITHUB_EVENT_PATH}" node -e "const e=require(process.env.SWARM_EVT_PATH); process.stdout.write(String(e.pull_request?.number ?? e.number ?? ''))")
    if [ -n "$INFERRED_PR" ]; then
      AUDIT_CMD+=("${GITHUB_REPOSITORY}#${INFERRED_PR}")
    else
      echo "Error: audit-mode=true but no PR ref available." >&2
      exit 2
    fi
  else
    echo "Error: audit-mode=true requires one of diff-file, pr, or pull_request event context." >&2
    exit 2
  fi

  AUDIT_CMD+=("--output" "json")
  if [ -n "$AUDIT_EMIT_AIBOM" ]; then
    AUDIT_CMD+=("--emit-aibom" "$AUDIT_EMIT_AIBOM")
  fi
  if [ -n "$REPO_ROOT" ]; then
    AUDIT_CMD+=("--repo-root" "$REPO_ROOT")
  fi

  echo "swarm-audit: ${AUDIT_CMD[*]}"
  AUDIT_JSON="$(mktemp)"
  AUDIT_LEDGER_DIR=".swarm/ledger"
  set +e
  "${AUDIT_CMD[@]}" > "$AUDIT_JSON"
  AUDIT_EXIT=$?
  set -e

  AUDIT_LEDGER="$(ls -t ${AUDIT_LEDGER_DIR}/audit-*.jsonl 2>/dev/null | head -n1 || true)"
  PASS_STR="false"
  if [ "$AUDIT_EXIT" = "0" ]; then PASS_STR="true"; fi
  BLOCKING_COUNT=$(SWARM_AUDIT_JSON="${AUDIT_JSON}" node -e "try{const r=require(process.env.SWARM_AUDIT_JSON);process.stdout.write(String(r.findings.filter(f=>f.severity==='block').length))}catch(e){process.stdout.write('0')}")

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "audit-pass=${PASS_STR}"
      echo "audit-findings=${BLOCKING_COUNT}"
      echo "audit-ledger=${AUDIT_LEDGER}"
    } >> "$GITHUB_OUTPUT"
  fi

  if [ "$AUDIT_COMMENT" = "true" ] && [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    PR_FOR_COMMENT="$AUDIT_PR"
    if [ -z "$PR_FOR_COMMENT" ] && [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH}" ]; then
      PR_FOR_COMMENT=$(SWARM_EVT_PATH="${GITHUB_EVENT_PATH}" node -e "const e=require(process.env.SWARM_EVT_PATH); process.stdout.write(String(e.pull_request?.number ?? e.number ?? ''))")
    fi
    if [ -n "$PR_FOR_COMMENT" ]; then
      PR_NUMBER="${PR_FOR_COMMENT##*#}"
      # Audit json path and ledger path both reach Node via env vars so a
      # filename with a single quote cannot escape the require() literal
      # or the ledgerUrl string literal.
      COMMENT_PAYLOAD=$(SWARM_AUDIT_JSON="${AUDIT_JSON}" SWARM_LEDGER_URL="${AUDIT_LEDGER}" node -e "
        const r = require(process.env.SWARM_AUDIT_JSON);
        const { renderPrComment } = require('/app/dist/src/audit/report-comment');
        const body = renderPrComment(r, { ledgerUrl: process.env.SWARM_LEDGER_URL });
        process.stdout.write(JSON.stringify({ body }));
      ")
      curl -sS -X POST \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        -H "Content-Type: application/json" \
        --data "$COMMENT_PAYLOAD" \
        "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
        > /dev/null || echo "swarm-audit: failed to post PR comment (continuing)" >&2
    fi
  fi

  exit $AUDIT_EXIT
fi

# ── Validate mode selection ───────────────────────────────────────────────
if [ -n "$GOAL" ] && [ -n "$CONTRACT_PATH" ]; then
  echo "Error: 'goal' and 'contract-path' are mutually exclusive." >&2
  exit 1
fi

if [ -z "$GOAL" ] && [ -z "$CONTRACT_PATH" ]; then
  echo "Error: provide either 'goal' or 'contract-path' (or set audit-mode: true)." >&2
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

# Redaction runs from the `trap redact_known_secrets EXIT` declared at the
# top of the script; that covers both the audit-mode and legacy paths plus
# any unexpected exits.
