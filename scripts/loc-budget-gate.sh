#!/usr/bin/env bash
set -euo pipefail

# Asserts total LOC across src/**/*.{ts,tsx} stays at or below the
# budget in evidence/loc-budget.txt.

BUDGET_FILE="evidence/loc-budget.txt"

if [[ ! -f "$BUDGET_FILE" ]]; then
  echo "loc-budget-gate: $BUDGET_FILE missing" >&2
  exit 2
fi

BUDGET="$(tr -d ' \n\t' < "$BUDGET_FILE")"
if ! [[ "$BUDGET" =~ ^[0-9]+$ ]]; then
  echo "loc-budget-gate: $BUDGET_FILE must contain a single integer (got: $BUDGET)" >&2
  exit 2
fi

CURRENT_LOC="$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 \
  | xargs -0 cat \
  | wc -l \
  | tr -d ' ')"

echo "loc: $CURRENT_LOC / budget $BUDGET"

if (( CURRENT_LOC > BUDGET )); then
  echo "FAIL: $CURRENT_LOC > $BUDGET" >&2
  exit 1
fi

echo "PASS"
