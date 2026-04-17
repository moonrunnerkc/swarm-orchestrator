#!/usr/bin/env bash
# A11Y-AXE: Accessibility scan clean
# Consumes the accessibility quality gate.
set -euo pipefail
DIR="$1"
ATTR="A11Y-AXE"

# Check for HTML files (UI task indicator)
HTML_FILES=$(find "$DIR" -name "*.html" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)
if [ -z "$HTML_FILES" ]; then
  # Also check for JSX/TSX (React)
  JSX_FILES=$(find "$DIR" -name "*.tsx" -o -name "*.jsx" | grep -v node_modules 2>/dev/null || true)
  if [ -z "$JSX_FILES" ]; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": false, \"present\": false, \"evidence_path\": null}"
    exit 2
  fi
fi

# Check for ARIA attributes and accessibility patterns
if grep -rql "aria-\|role=\|alt=\|<label\|tabindex\|role=\"" \
  "$DIR" --include="*.html" --include="*.tsx" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  EVIDENCE=$(grep -rl "aria-\|role=" \
    "$DIR" --include="*.html" --include="*.tsx" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
