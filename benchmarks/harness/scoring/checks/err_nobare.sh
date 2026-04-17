#!/usr/bin/env bash
# ERR-NOBARE: No bare catch/except (empty catch bodies)
set -euo pipefail
DIR="$1"
ATTR="ERR-NOBARE"

# Look for empty catch blocks in JS/TS
BARE_JS=$(grep -rn "catch\s*([^)]*)\s*{\s*}" "$DIR" \
  --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null || true)

# Look for bare except in Python
BARE_PY=$(grep -rn "except:\s*$\|except\s*Exception\s*:\s*$" "$DIR" \
  --include="*.py" --exclude-dir=__pycache__ --exclude-dir=.git 2>/dev/null || true)

COMBINED="$BARE_JS$BARE_PY"

if [ -z "$COMBINED" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
  exit 0
else
  FIRST_FILE=$(echo "$COMBINED" | head -1 | cut -d: -f1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"$FIRST_FILE\"}"
  exit 1
fi
