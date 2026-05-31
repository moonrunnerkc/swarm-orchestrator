#!/usr/bin/env bash
# Pull recent merged PRs from a fixed set of AI-coding-tool repos and write
# the combined list to outputs/wild-scan/pr-list.txt as one "owner/repo#num"
# per line. Caller decides how many per repo via the PER_REPO env var
# (default 8).

set -euo pipefail

PER_REPO="${PER_REPO:-8}"
OUT="outputs/wild-scan/pr-list.txt"

REPOS=(
  paul-gauthier/aider
  sst/opencode
  cline/cline
  continuedev/continue
  All-Hands-AI/OpenHands
  RooCodeInc/Roo-Code
)

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

for repo in "${REPOS[@]}"; do
  echo "fetching ${PER_REPO} merged PRs from ${repo}..." >&2
  gh pr list --repo "$repo" \
    --state merged \
    --limit "$PER_REPO" \
    --json number \
    --jq ".[] | \"${repo}#\\(.number)\"" >> "$OUT"
done

count=$(wc -l < "$OUT" | tr -d ' ')
echo "wrote ${count} PRs to ${OUT}" >&2
