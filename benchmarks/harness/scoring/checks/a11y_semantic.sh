#!/usr/bin/env bash
# A11Y-SEMANTIC: Semantic HTML
# Checks for nav, main, header, footer elements instead of div soup.
set -euo pipefail
DIR="$1"
ATTR="A11Y-SEMANTIC"

HTML_FILES=$(find "$DIR" -name "*.html" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)
JSX_FILES=$(find "$DIR" \( -name "*.tsx" -o -name "*.jsx" \) -not -path "*/node_modules/*" 2>/dev/null || true)

ALL_FILES="$HTML_FILES $JSX_FILES"
if [ -z "$(echo "$ALL_FILES" | tr -d ' ')" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": false, \"present\": false, \"evidence_path\": null}"
  exit 2
fi

# Check for semantic elements
SEMANTIC_COUNT=0
for TAG in "<nav" "<main" "<header" "<footer" "<section" "<article"; do
  if grep -rql "$TAG" "$DIR" --include="*.html" --include="*.tsx" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
    SEMANTIC_COUNT=$((SEMANTIC_COUNT + 1))
  fi
done

if [ "$SEMANTIC_COUNT" -ge 2 ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": null}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
