#!/usr/bin/env bash
# SEC-NOSECRETS: No secrets/credentials in source
# Delegates to the hardcoded-config gate pattern. Scans for API keys, passwords, tokens in non-.env files.
set -euo pipefail
DIR="$1"
ATTR="SEC-NOSECRETS"

# Patterns that indicate hardcoded secrets (exclude .env, .env.*, node_modules, .git)
SECRETS_FOUND=$(grep -rn \
  "sk-[a-zA-Z0-9]\{20,\}\|AKIA[A-Z0-9]\{16\}\|ghp_[a-zA-Z0-9]\{36\}\|password\s*=\s*[\"'][^\"']\{8,\}\|api_key\s*=\s*[\"'][^\"']\{8,\}\|secret\s*=\s*[\"'][^\"']\{8,\}" \
  "$DIR" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude="*.env" --exclude="*.env.*" --exclude="package-lock.json" \
  2>/dev/null || true)

if [ -z "$SECRETS_FOUND" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
  exit 0
else
  FIRST_FILE=$(echo "$SECRETS_FOUND" | head -1 | cut -d: -f1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"$FIRST_FILE\"}"
  exit 1
fi
