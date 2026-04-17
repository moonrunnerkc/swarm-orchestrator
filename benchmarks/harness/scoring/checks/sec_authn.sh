#!/usr/bin/env bash
# SEC-AUTHN: Authentication present (if user-facing)
set -euo pipefail
DIR="$1"
ATTR="SEC-AUTHN"

# Look for JWT/auth middleware patterns
if grep -rql "jsonwebtoken\|passport\|express-jwt\|jwt\|bcrypt\|argon2\|auth.*middleware\|authenticate\|verify.*token" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "jsonwebtoken\|passport\|jwt\|authenticate\|verify.*token" \
    "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
