#!/usr/bin/env bash
# PROD-README: README documents the change
set -euo pipefail
DIR="$1"
ATTR="PROD-README"

if [ -f "$DIR/README.md" ] || [ -f "$DIR/readme.md" ] || [ -f "$DIR/README.rst" ]; then
  README=""
  for candidate in "$DIR/README.md" "$DIR/readme.md" "$DIR/README.rst"; do
    [ -f "$candidate" ] && README="$candidate" && break
  done
  # Check it has meaningful content (more than just a title)
  LINES=$(wc -l < "$README")
  if [ "$LINES" -ge 5 ]; then
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$README\"}"
    exit 0
  fi
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
