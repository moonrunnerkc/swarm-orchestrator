#!/usr/bin/env bash
# SEC-INPUT: Input validation on all user-facing endpoints
# Checks for validation middleware/decorators (express-validator, joi, zod, celebrate, pydantic).
set -euo pipefail
DIR="$1"
ATTR="SEC-INPUT"

# Look for validation libraries or middleware patterns
# NOTE: Capture a single file via subshell with pipefail disabled to avoid SIGPIPE exit 141.
# NOTE: Always --exclude-dir=node_modules to avoid false positives from deps.
_first_match() { set +o pipefail; grep -rl "$@" 2>/dev/null | head -1; }
EVIDENCE=""
if grep -rql "express-validator\|celebrate\|@hapi/joi\|zod\|yup\|ajv\|class-validator" "$DIR" --include="*.ts" --include="*.js" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(_first_match "express-validator\|celebrate\|@hapi/joi\|zod\|yup\|ajv\|class-validator" "$DIR" --include="*.ts" --include="*.js" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git)
elif grep -rql "pydantic\|marshmallow\|wtforms\|cerberus" "$DIR" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(_first_match "pydantic\|marshmallow\|wtforms\|cerberus" "$DIR" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git)
elif grep -rql "validate\|validation\|sanitize\|isValid" "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(_first_match "validate\|validation\|sanitize\|isValid" "$DIR" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git)
fi

if [ -n "$EVIDENCE" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
