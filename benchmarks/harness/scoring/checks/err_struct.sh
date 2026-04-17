#!/usr/bin/env bash
# ERR-STRUCT: Structured error responses
# Checks for error middleware that returns JSON with error/message fields.
set -euo pipefail
DIR="$1"
ATTR="ERR-STRUCT"

# Look for error handling middleware patterns
if grep -rql "err.*res.*json\|error.*middleware\|app\.use.*err\|@app\.errorhandler\|exception_handler" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "err.*res.*json\|error.*middleware\|app\.use.*err" \
    "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Check for structured error response patterns
if grep -rql "{ error:\|{error:\|\"error\":\|\"message\":" \
  "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "{ error:\|{error:\|\"error\":" \
    "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
