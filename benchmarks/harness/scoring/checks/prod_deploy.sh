#!/usr/bin/env bash
# PROD-DEPLOY: Deploy artifact present (Dockerfile, docker-compose, or equivalent)
set -euo pipefail
DIR="$1"
ATTR="PROD-DEPLOY"

EVIDENCE=""
for candidate in "$DIR/Dockerfile" "$DIR/docker-compose.yml" "$DIR/docker-compose.yaml"; do
  [ -f "$candidate" ] && EVIDENCE="$candidate" && break
done
if [ -n "$EVIDENCE" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

# Vercel, Netlify, or similar deploy configs
EVIDENCE=""
for candidate in "$DIR/vercel.json" "$DIR/netlify.toml" "$DIR/fly.toml" "$DIR/render.yaml"; do
  [ -f "$candidate" ] && EVIDENCE="$candidate" && break
done
if [ -n "$EVIDENCE" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
fi

echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
exit 1
