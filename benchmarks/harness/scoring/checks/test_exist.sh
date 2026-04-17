#!/usr/bin/env bash
# TEST-EXIST: Tests exist
set -euo pipefail
DIR="$1"
ATTR="TEST-EXIST"

# Look for test files
TEST_FILES=$(find "$DIR" \
  \( -name "*.test.ts" -o -name "*.test.js" -o -name "*.test.tsx" -o -name "*.test.jsx" \
     -o -name "*.spec.ts" -o -name "*.spec.js" -o -name "*.spec.tsx" -o -name "*.spec.jsx" \
     -o -name "test_*.py" -o -name "*_test.py" -o -name "*_test.go" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)

if [ -n "$TEST_FILES" ]; then
  EVIDENCE=$(echo "$TEST_FILES" | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Also check for __tests__ directories
if find "$DIR" -type d -name "__tests__" -not -path "*/node_modules/*" 2>/dev/null | grep -q .; then
  EVIDENCE=$(find "$DIR" -type d -name "__tests__" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Check for test/ directory with files
if [ -d "$DIR/test" ] && find "$DIR/test" -name "*.js" -o -name "*.ts" -o -name "*.py" 2>/dev/null | grep -q .; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$DIR/test\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
