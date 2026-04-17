#!/usr/bin/env bash
# TEST-PASS: All tests pass (CI-equivalent)
# Consumes the runtime-checks gate (runTests).
set -euo pipefail
DIR="$1"
ATTR="TEST-PASS"

cd "$DIR"

if [ -f "package.json" ]; then
  TEST_CMD=$(jq -r '.scripts.test // empty' package.json 2>/dev/null || true)
  if [ -z "$TEST_CMD" ] || [ "$TEST_CMD" = "echo \"Error: no test specified\" && exit 1" ]; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
  if timeout 120 npm test 2>&1; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"package.json\"}"
    exit 0
  else
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  if timeout 120 python3 -m pytest 2>&1; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"pyproject.toml\"}"
    exit 0
  else
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"pyproject.toml\"}"
    exit 1
  fi
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
