#!/usr/bin/env bash
# ERR-UNHANDLED: Unhandled-rejection/exception handlers
set -euo pipefail
DIR="$1"
ATTR="ERR-UNHANDLED"

# Node.js patterns
if grep -rql "process\.on.*unhandledRejection\|process\.on.*uncaughtException" \
  "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(set +o pipefail; grep -rl "process\.on.*unhandledRejection\|process\.on.*uncaughtException" \
    "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Python patterns (sys.excepthook, asyncio exception handler)
if grep -rql "sys\.excepthook\|loop\.set_exception_handler\|atexit" \
  "$DIR" --include="*.py" --exclude-dir=__pycache__ --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl -m1 "sys\.excepthook\|loop\.set_exception_handler" \
    "$DIR" --include="*.py" --exclude-dir=__pycache__ --exclude-dir=.git 2>/dev/null || true)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
