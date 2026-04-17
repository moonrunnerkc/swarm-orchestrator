#!/usr/bin/env bash
# SEC-DEPS: Dependency audit clean
# Runs npm audit --audit-level=moderate or pip-audit.
set -euo pipefail
DIR="$1"
ATTR="SEC-DEPS"

cd "$DIR"

if [ -f "package.json" ] && [ -d "node_modules" ]; then
  if npm audit --audit-level=moderate 2>/dev/null; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"package.json\"}"
    exit 0
  else
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
elif [ -f "package.json" ]; then
  # No node_modules — install first
  npm install --ignore-scripts 2>/dev/null || true
  if npm audit --audit-level=moderate 2>/dev/null; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"package.json\"}"
    exit 0
  else
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": false, \"present\": false, \"evidence_path\": null}"
  exit 2
fi
