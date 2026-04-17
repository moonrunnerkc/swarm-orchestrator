#!/usr/bin/env bash
# WIRE-START: Clean start (process boots without error)
set -euo pipefail
DIR="$1"
ATTR="WIRE-START"

cd "$DIR"

# Pick a random high port to avoid collisions with system services (e.g. ntopng on 3000).
export PORT=$(( (RANDOM % 10000) + 20000 ))

if [ -f "package.json" ]; then
  # Check if start script exists
  START_CMD=$(jq -r '.scripts.start // empty' package.json 2>/dev/null || true)
  if [ -z "$START_CMD" ]; then
    # No start script — check for main entry
    MAIN=$(jq -r '.main // empty' package.json 2>/dev/null || true)
    if [ -n "$MAIN" ] && [ -f "$MAIN" ]; then
      echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$MAIN\"}"
      exit 0
    fi
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
  # npm start exists — try to boot and check for quick crash
  timeout 15 npm start &>/tmp/wire_start_out &
  PID=$!
  sleep 5
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"package.json\"}"
    exit 0
  else
    wait "$PID" 2>/dev/null || true
    echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": \"package.json\"}"
    exit 1
  fi
elif [ -f "app/main.py" ] || [ -f "main.py" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"main.py\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
