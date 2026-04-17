#!/usr/bin/env bash
# SEC-AUTHZ: Authorization/RBAC present (if user-facing)
set -euo pipefail
DIR="$1"
ATTR="SEC-AUTHZ"

# Look for role-based access patterns
if grep -rql "role\|rbac\|authorize\|isAdmin\|hasRole\|permission\|access.*control\|require.*role" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "role\|rbac\|authorize\|isAdmin\|hasRole\|permission" \
    "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
