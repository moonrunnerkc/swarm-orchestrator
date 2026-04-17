#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://localhost:8000/api/health}"
RETRIES="${2:-5}"
INTERVAL="${3:-2}"

for i in $(seq 1 "${RETRIES}"); do
    response=$(curl --fail --silent --max-time 5 "${URL}") && {
        # Parse status using node (always available in this project) or fall back to grep
        status=$(node -e "console.log(JSON.parse(process.argv[1]).status)" "${response}" 2>/dev/null \
            || echo "${response}" | grep -oP '"status"\s*:\s*"\K[^"]+' 2>/dev/null \
            || echo "unknown")

        if [ "${status}" = "ok" ] || [ "${status}" = "healthy" ]; then
            echo "OK: ${URL} → status=${status}"
            exit 0
        else
            echo "DEGRADED: ${URL} → status=${status}"
            echo "${response}"
            exit 1
        fi
    }

    if [ "${i}" -lt "${RETRIES}" ]; then
        echo "Attempt ${i}/${RETRIES} failed, retrying in ${INTERVAL}s..."
        sleep "${INTERVAL}"
    fi
done

echo "FAIL: health endpoint unreachable at ${URL} after ${RETRIES} attempts"
exit 1
