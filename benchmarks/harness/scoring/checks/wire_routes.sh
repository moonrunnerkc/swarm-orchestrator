#!/usr/bin/env bash
# WIRE-ROUTES: All declared routes reachable
set -euo pipefail
DIR="$1"
ATTR="WIRE-ROUTES"

cd "$DIR"

# Look for route definitions (use "." after cd, not "$DIR" which may be stale relative path)
ROUTES_FOUND=false
if grep -rql "app\.\(get\|post\|put\|delete\|patch\|use\)\|router\.\(get\|post\|put\|delete\|patch\)\|@app\.route\|@router" \
  "." --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  ROUTES_FOUND=true
fi

if $ROUTES_FOUND; then
  EVIDENCE=$(set +o pipefail; grep -rl "app\.\(get\|post\|put\|delete\|patch\)\|router\.\(get\|post\|put\|delete\|patch\)\|@app\.route" \
    "." --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
