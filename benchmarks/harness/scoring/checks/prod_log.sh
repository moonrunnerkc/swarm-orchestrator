#!/usr/bin/env bash
# PROD-LOG: Structured logging
# Checks for structured logger dependency or JSON log output.
set -euo pipefail
DIR="$1"
ATTR="PROD-LOG"

# Check for structured logging libraries
if grep -rql "winston\|pino\|bunyan\|structlog\|log4js\|morgan.*json\|logging\.config" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "winston\|pino\|bunyan\|structlog\|log4js" \
    "$DIR" --include="*.ts" --include="*.js" --include="*.py" --include="*.json" \
    --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Check for JSON.stringify in log calls
if grep -rql "console\.log.*JSON\.stringify\|logger\.info\|logger\.error\|logger\.warn" \
  "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "logger\.\(info\|error\|warn\)" \
    "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
