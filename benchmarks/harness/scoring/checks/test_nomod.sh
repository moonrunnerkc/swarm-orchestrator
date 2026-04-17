#!/usr/bin/env bash
# TEST-NOMOD: No test-file modifications beyond additions
# Uses git diff to check that existing test files were not modified.
set -euo pipefail
DIR="$1"
META="$2"
ATTR="TEST-NOMOD"

cd "$DIR"

# Get base commit from task metadata
BASE_COMMIT=$(jq -r '.seed_repo_state // "HEAD~1"' "$META" 2>/dev/null || echo "HEAD~1")
if [ "$BASE_COMMIT" = "HEAD" ]; then
  BASE_COMMIT="HEAD~1"
fi

# Check for modified (not added) test files
MODIFIED_TESTS=$(git diff --name-only --diff-filter=M "$BASE_COMMIT" -- \
  'tests/**' 'test/**' '**/test_*.py' '**/*_test.py' \
  '**/*.test.ts' '**/*.test.tsx' '**/*.test.js' '**/*.test.jsx' \
  '**/*.spec.ts' '**/*.spec.js' '**/__tests__/**' 2>/dev/null || true)

if [ -z "$MODIFIED_TESTS" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
  exit 0
else
  FIRST=$(echo "$MODIFIED_TESTS" | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"$FIRST\"}"
  exit 1
fi
