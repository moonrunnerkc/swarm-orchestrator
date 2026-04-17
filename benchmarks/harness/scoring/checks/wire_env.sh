#!/usr/bin/env bash
# WIRE-ENV: Environment variable contract documented and enforced
set -euo pipefail
DIR="$1"
ATTR="WIRE-ENV"

# Look for .env.example, .env.template, .env.sample, or env documentation
EVIDENCE=""
for candidate in "$DIR/.env.example" "$DIR/.env.template" "$DIR/.env.sample"; do
  [ -f "$candidate" ] && EVIDENCE="$candidate" && break
done
if [ -n "$EVIDENCE" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Fallback: check if code references process.env or os.environ
if grep -rql "process\.env\.\|os\.environ\|os\.getenv\|dotenv" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  # Code uses env vars but no .env.example — partial credit denied, must document
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi

# No env usage at all — not applicable
echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
