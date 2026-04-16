#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://localhost:8000/api/health}"
TIMEOUT="${2:-5}"

response=$(curl --fail --silent --max-time "${TIMEOUT}" "${URL}") || {
    echo "FAIL: health endpoint unreachable at ${URL}"
    exit 1
}

status=$(echo "${response}" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")

if [ "${status}" = "ok" ]; then
    echo "OK: ${URL} → status=${status}"
    exit 0
else
    echo "DEGRADED: ${URL} → status=${status}"
    echo "${response}"
    exit 1
fi
