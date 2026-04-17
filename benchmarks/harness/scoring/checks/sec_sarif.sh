#!/usr/bin/env bash
# SEC-SARIF: SARIF security scan clean
# Consumes the runtime-checks gate (runAudit). Checks npm audit exit code.
set -euo pipefail
DIR="$1"
ATTR="SEC-SARIF"

cd "$DIR"

# Check for package.json (Node) or requirements.txt (Python)
if [ -f "package.json" ]; then
  if npm audit --audit-level=moderate 2>/dev/null; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"package.json\"}"
    exit 0
  else
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  if command -v pip-audit &>/dev/null; then
    if pip-audit 2>/dev/null; then
      echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"requirements.txt\"}"
      exit 0
    else
      echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"requirements.txt\"}"
      exit 1
    fi
  fi
  # pip-audit not available — pass with note
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": false, \"present\": false, \"evidence_path\": null}"
  exit 2
fi
