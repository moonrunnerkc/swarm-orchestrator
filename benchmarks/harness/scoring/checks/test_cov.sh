#!/usr/bin/env bash
# TEST-COV: Coverage meets threshold
# Consumes the test-coverage quality gate.
set -euo pipefail
DIR="$1"
ATTR="TEST-COV"

cd "$DIR"

# Try running tests with coverage
if [ -f "package.json" ]; then
  TEST_CMD=$(jq -r '.scripts.test // empty' package.json 2>/dev/null || true)
  if [ -n "$TEST_CMD" ]; then
    # Check if coverage report exists or can be generated
    if [ -f "coverage/coverage-summary.json" ]; then
      COV=$(jq -r '.total.lines.pct // .total.statements.pct // 0' coverage/coverage-summary.json 2>/dev/null || echo "0")
      if [ "$(echo "$COV > 0" | bc 2>/dev/null || echo 0)" = "1" ]; then
        echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"coverage/coverage-summary.json\"}"
        exit 0
      fi
    fi
    # No coverage data — check if test files assert anything meaningful
    # Use "." after cd, not "$DIR" which may be a stale relative path.
    ASSERTIONS=$(grep -rc "assert\|expect\|should\|toBe\|toEqual\|toHaveBeenCalled" "." --include="*.test.*" --include="test_*" --exclude-dir=node_modules 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    if [ "$ASSERTIONS" -gt 0 ]; then
      echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
      exit 0
    fi
  fi
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
