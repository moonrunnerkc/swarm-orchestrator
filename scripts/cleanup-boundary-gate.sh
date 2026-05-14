#!/usr/bin/env bash
set -euo pipefail

# Three checks gating the v8-only cleanup sequence (Phase 0 of the
# optimization plan). Runs on every PR via .github/workflows/ci.yml.
#
#   1. Total LOC across src/**/*.{ts,tsx} stays at or below the budget
#      in evidence/loc-budget.txt.
#   2. The v6 entry surface imports nothing from v8 directories.
#   3. The v8 directories import nothing from the v6 entry surface.
#
# Patterns mirror the import-boundary greps in coding-optimization-report.md
# (cut #1, the v6 deletion). Any new cross-boundary import in either
# direction is a Phase 6 blocker and fails CI immediately.

BUDGET_FILE="evidence/loc-budget.txt"

if [[ ! -f "$BUDGET_FILE" ]]; then
  echo "cleanup-boundary-gate: $BUDGET_FILE missing" >&2
  exit 2
fi

BUDGET="$(tr -d ' \n\t' < "$BUDGET_FILE")"
if ! [[ "$BUDGET" =~ ^[0-9]+$ ]]; then
  echo "cleanup-boundary-gate: $BUDGET_FILE must contain a single integer (got: $BUDGET)" >&2
  exit 2
fi

CURRENT_LOC="$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 \
  | xargs -0 cat \
  | wc -l \
  | tr -d ' ')"

echo "loc: $CURRENT_LOC / budget $BUDGET"

failed=0

if (( CURRENT_LOC > BUDGET )); then
  echo "FAIL [#1 loc-budget]: $CURRENT_LOC > $BUDGET" >&2
  failed=1
else
  echo "PASS [#1 loc-budget]"
fi

V6_ENTRY_FILES=(
  src/swarm-orchestrator.ts
  src/plan-generator.ts
  src/session-executor.ts
  src/share-parser.ts
  src/repair-agent.ts
  src/verifier-engine.ts
  src/pr-manager.ts
  src/pm-agent.ts
  src/branch-merger.ts
  src/cli/swarm-handlers.ts
)
V6_ENTRY_DIRS=(
  src/orchestrator
  src/verifier
)

V8_IMPORT_PATTERN="from '\\.\\./contract'\
\\|from '\\.\\./contract/\
\\|from '\\.\\./session'\
\\|from '\\.\\./session/\
\\|from '\\.\\./persona'\
\\|from '\\.\\./persona/\
\\|from '\\.\\./population'\
\\|from '\\.\\./population/\
\\|from '\\.\\./ledger'\
\\|from '\\.\\./ledger/\
\\|from '\\.\\./wasm'\
\\|from '\\.\\./wasm/\
\\|from '\\.\\./falsification'\
\\|from '\\.\\./falsification/"

v6_to_v8_hits="$(grep -rl "$V8_IMPORT_PATTERN" \
  "${V6_ENTRY_FILES[@]}" "${V6_ENTRY_DIRS[@]}" 2>/dev/null || true)"

if [[ -n "$v6_to_v8_hits" ]]; then
  echo "FAIL [#2 v6→v8 imports]:" >&2
  printf '  %s\n' $v6_to_v8_hits >&2
  failed=1
else
  echo "PASS [#2 v6→v8 imports]"
fi

V8_DIRS=(
  src/contract
  src/session
  src/persona
  src/population
  src/ledger
  src/wasm
  src/falsification
  src/cli/v8
)

V6_IMPORT_PATTERN="from '\\.\\./swarm-orchestrator'\
\\|from '\\.\\./plan-generator'\
\\|from '\\.\\./session-executor'\
\\|from '\\.\\./share-parser'\
\\|from '\\.\\./repair-agent'\
\\|from '\\.\\./verifier-engine'\
\\|from '\\.\\./pr-manager'\
\\|from '\\.\\./pm-agent'\
\\|from '\\.\\./branch-merger'\
\\|from '\\.\\./orchestrator/\
\\|from '\\.\\./verifier/"

v8_to_v6_hits="$(grep -rl "$V6_IMPORT_PATTERN" "${V8_DIRS[@]}" 2>/dev/null || true)"

if [[ -n "$v8_to_v6_hits" ]]; then
  echo "FAIL [#3 v8→v6 imports]:" >&2
  printf '  %s\n' $v8_to_v6_hits >&2
  failed=1
else
  echo "PASS [#3 v8→v6 imports]"
fi

if (( failed )); then
  exit 1
fi
