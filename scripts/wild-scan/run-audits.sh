#!/usr/bin/env bash
# Run `swarm audit --shadow` against every PR in outputs/wild-scan/pr-list.txt.
# Output: outputs/wild-scan/raw/<repo-label>/audit-<run-id>.json (one per PR).
# Per-PR stdout/stderr captured to outputs/wild-scan/logs/<repo>-<pr>.log.
#
# Skips PRs whose JSON record already exists by matching on the PR ref inside
# any existing shadow JSON (cheap rerun).

set -uo pipefail

LIST="outputs/wild-scan/pr-list.txt"
RAW_DIR="outputs/wild-scan/raw"
LOG_DIR="outputs/wild-scan/logs"
CLI="node dist/src/cli.js"

mkdir -p "$RAW_DIR" "$LOG_DIR"

# The audit's pr-fetch uses GITHUB_TOKEN; without it we hit the 60/hr public
# limit fast. Pull it from `gh` so we don't have to manage a separate token.
if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if tok=$(gh auth token 2>/dev/null) && [[ -n "$tok" ]]; then
    export GITHUB_TOKEN="$tok"
  fi
fi

if [[ ! -s "$LIST" ]]; then
  echo "no PRs in ${LIST}; run source-prs.sh first" >&2
  exit 1
fi

total=$(wc -l < "$LIST" | tr -d ' ')
i=0
ok=0
fail=0

while IFS= read -r pr_ref; do
  i=$((i+1))
  [[ -z "$pr_ref" ]] && continue

  # owner/repo#num -> owner__repo__num for log filename, repo-base for shadow label
  repo_full="${pr_ref%#*}"
  pr_num="${pr_ref#*#}"
  repo_base="${repo_full##*/}"
  log_file="${LOG_DIR}/${repo_full//\//__}__${pr_num}.log"

  # cheap idempotency: if any shadow JSON under raw/<repo_base>/ already
  # references this PR number for this repository, skip.
  if grep -rqsF "\"repository\": \"${repo_full}\"" "${RAW_DIR}/${repo_base}" 2>/dev/null \
     && grep -rqsF "\"number\": ${pr_num}," "${RAW_DIR}/${repo_base}" 2>/dev/null; then
    echo "[${i}/${total}] skip ${pr_ref} (already audited)"
    continue
  fi

  echo "[${i}/${total}] audit ${pr_ref}"
  if $CLI audit --pr "$pr_ref" \
        --shadow "$repo_base" \
        --shadow-dir "$RAW_DIR" \
        --output json > "$log_file" 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1))
    echo "  FAILED (see ${log_file})"
  fi
done < "$LIST"

echo "---"
echo "done: ${ok} ok, ${fail} failed, ${total} total"
