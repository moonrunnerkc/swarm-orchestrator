#!/usr/bin/env bash
set -euo pipefail

# prose-gate: fails on any em dash (U+2014) in tracked files outside the
# exemption list below. Authored prose and code use commas, colons,
# semicolons, periods, or restructured sentences instead (see the
# writing rules in CLAUDE.md). Run as `npm run prose:check`; wired into
# CI alongside badges:check.
#
# Exemptions, by reason:
# - Third-party payloads, never edited, original punctuation preserved:
#   vendored PR diffs (benchmarks/real-prs/), raw corpus entries and
#   fixture payloads (benchmarks/real-corpus/raw/, fp-registry/),
#   oracle cases derived from vendored diffs (*.diff, *.label.json and
#   the sample hunks embedded in injection-coverage.md), twin and
#   regression corpora.
# - Frozen ground truth and run records, where an edit would either
#   break the ground-truth freeze or falsify a historical record:
#   hand labels, score snapshots, the wild-scan records under outputs/
#   (they embed third-party PR bodies verbatim), and the historical
#   evidence dirs.
# - Tooling managed by a third-party CLI that regenerates its files:
#   .ocr/ and the OCR command shims under .claude/commands/ocr/.
# - package-lock.json (npm-generated).

EMDASH=$'\xe2\x80\x94'

EXEMPT_REGEX='^(package-lock\.json$|outputs/|benchmarks/real-prs/|benchmarks/real-corpus/(raw|labels|fp-registry|scores|scores-outcome)/|benchmarks/oracle-corpus/[^/]+/[^/]+/|benchmarks/oracle-corpus/injection-coverage\.md$|benchmarks/twins/|benchmarks/regression-corpus/|evidence/(baseline-v8\.0\.3|fixtures|lift|live-wiring|phase-2-parity|phase-3-parity)/|\.ocr/|\.claude/commands/ocr/)'

mapfile -t hits < <(git ls-files | grep -Ev "$EXEMPT_REGEX" | xargs -d '\n' grep -Il "$EMDASH" -- 2>/dev/null || true)

if (( ${#hits[@]} > 0 )); then
  for f in "${hits[@]}"; do
    echo "prose-gate: em dash in $f" >&2
    grep -n "$EMDASH" -- "$f" | head -3 >&2
  done
  echo "prose-gate: FAIL (${#hits[@]} file(s)). Replace em dashes with commas, colons, periods, or restructure. Vendored third-party content belongs on the exemption list in scripts/prose-gate.sh, not in an edit." >&2
  exit 1
fi

echo "prose-gate: PASS (no em dashes outside the exemption list)"
