#!/usr/bin/env bash
# Re-run the same PR list with --detectors experimental (default 4 + the 6
# retired detectors). Output goes under outputs/wild-scan/raw-experimental/.

set -uo pipefail

LIST="outputs/wild-scan/pr-list.txt"
RAW_DIR="outputs/wild-scan/raw-experimental"
LOG_DIR="outputs/wild-scan/logs-experimental"
CLI="node dist/src/cli.js"

mkdir -p "$RAW_DIR" "$LOG_DIR"

if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if tok=$(gh auth token 2>/dev/null) && [[ -n "$tok" ]]; then
    export GITHUB_TOKEN="$tok"
  fi
fi

total=$(wc -l < "$LIST" | tr -d ' ')
i=0
ok=0
fail=0

while IFS= read -r pr_ref; do
  i=$((i+1))
  [[ -z "$pr_ref" ]] && continue
  repo_full="${pr_ref%#*}"
  pr_num="${pr_ref#*#}"
  repo_base="${repo_full##*/}"
  log_file="${LOG_DIR}/${repo_full//\//__}__${pr_num}.log"

  if grep -rqsF "\"repository\": \"${repo_full}\"" "${RAW_DIR}/${repo_base}" 2>/dev/null \
     && grep -rqsF "\"number\": ${pr_num}," "${RAW_DIR}/${repo_base}" 2>/dev/null; then
    echo "[${i}/${total}] skip ${pr_ref} (already audited)"
    continue
  fi

  echo "[${i}/${total}] audit ${pr_ref}"
  if $CLI audit --pr "$pr_ref" \
        --detectors experimental \
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
