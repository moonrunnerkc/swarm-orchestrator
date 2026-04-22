#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# fetch-fixtures.sh — clone pinned OSS SHAs, tar the relevant
# subset, and verify each tarball matches the sha256 recorded in
# SOURCES.md.
#
# Usage:
#   scripts/fetch-fixtures.sh                # fetch + verify all
#   scripts/fetch-fixtures.sh --verify-only  # no fetch; fail on drift
#   scripts/fetch-fixtures.sh <task-id>      # one task only
#
# Output tarballs land in benchmarks/constraint-binding/fixtures/
# (gitignored). SOURCES.md is the source of truth.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CB_DIR="$REPO_ROOT/benchmarks/constraint-binding"
FIXTURES_DIR="$CB_DIR/fixtures"
SOURCES_MD="$CB_DIR/SOURCES.md"
CACHE_DIR="${FIXTURE_CACHE_DIR:-$CB_DIR/.cache}"

VERIFY_ONLY=0
FILTER_ID=""

for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=1 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) echo "ERROR: unknown flag: $arg" >&2; exit 2 ;;
    *)  FILTER_ID="$arg" ;;
  esac
done

if [ ! -f "$SOURCES_MD" ]; then
  echo "ERROR: $SOURCES_MD not found. Run from repo root." >&2
  exit 1
fi

mkdir -p "$FIXTURES_DIR" "$CACHE_DIR"

# ── parse SOURCES.md ────────────────────────────────────────────
# Expected table schema, one row per task:
#   | task-id | repo URL | SHA | subpath | sha256 |
# subpath is the path within the source repo to tar. Use "." for the
# whole checkout. Header rows and the separator (---) are skipped.

declare -a ROWS=()
while IFS='|' read -r _ id repo sha sub hash _; do
  id="$(echo "$id" | xargs || true)"
  repo="$(echo "$repo" | xargs || true)"
  sha="$(echo "$sha" | xargs || true)"
  sub="$(echo "$sub" | xargs || true)"
  hash="$(echo "$hash" | xargs || true)"
  [ -z "$id" ] && continue
  case "$id" in
    'task-id'|'-'*|'--'*) continue ;;
  esac
  [ -n "$FILTER_ID" ] && [ "$id" != "$FILTER_ID" ] && continue
  ROWS+=("$id|$repo|$sha|$sub|$hash")
done < <(grep -E '^\|' "$SOURCES_MD")

if [ ${#ROWS[@]} -eq 0 ]; then
  echo "ERROR: no rows parsed from $SOURCES_MD (filter: '${FILTER_ID:-<none>}')" >&2
  exit 1
fi

FAIL=0
PASS=0

for row in "${ROWS[@]}"; do
  IFS='|' read -r id repo sha sub hash <<<"$row"
  [ "$sub" = "-" ] && sub="."
  tar_out="$FIXTURES_DIR/${id}.tar.gz"

  # ── verify-only path ─────────────────────────────────────────
  if [ "$VERIFY_ONLY" -eq 1 ]; then
    if [ ! -f "$tar_out" ]; then
      echo "✗ $id — tarball missing: $tar_out"
      FAIL=$((FAIL+1))
      continue
    fi
    actual="$(sha256sum "$tar_out" | awk '{print $1}')"
    if [ "$actual" != "$hash" ]; then
      echo "✗ $id — sha256 mismatch"
      echo "    recorded: $hash"
      echo "    actual:   $actual"
      FAIL=$((FAIL+1))
      continue
    fi
    PASS=$((PASS+1))
    continue
  fi

  # ── fetch path ───────────────────────────────────────────────
  if [ -f "$tar_out" ]; then
    actual="$(sha256sum "$tar_out" | awk '{print $1}')"
    if [ "$actual" = "$hash" ]; then
      echo "✓ $id — cached, sha256 matches"
      PASS=$((PASS+1))
      continue
    fi
    echo "⟳ $id — cached tarball differs; refetching"
    rm -f "$tar_out"
  fi

  # Clone to a per-repo cache so multiple tasks reusing the same repo
  # don't re-clone. Fetch the exact SHA, then checkout.
  slug="$(echo "$repo" | sed -E 's|https?://||; s|[/:]|-|g; s|\.git$||')"
  repo_cache="$CACHE_DIR/$slug"
  if [ ! -d "$repo_cache/.git" ]; then
    echo "→ cloning $repo into $repo_cache"
    git clone --quiet --filter=blob:none "$repo" "$repo_cache" >/dev/null
  fi
  ( cd "$repo_cache" && git fetch --quiet origin "$sha" 2>/dev/null || true )
  if ! ( cd "$repo_cache" && git cat-file -e "${sha}^{commit}" 2>/dev/null ); then
    echo "✗ $id — SHA $sha not reachable in $repo"
    FAIL=$((FAIL+1))
    continue
  fi

  # Deterministic export: `git archive --format=tar <sha>[:<subpath>]` emits tar
  # entries with mtime set to the commit date, so the tar stream is bit-identical
  # for a given SHA. `gzip -n` strips the gzip header's filename + mtime so the
  # .tar.gz is reproducible too.
  #
  # Subpath handling: `git archive <sha> -- <subpath>` preserves the subpath
  # as a prefix on every tar entry (files appear as `databases/turso/...`).
  # That's wrong for our use case — the task prompt tells the agent about
  # files at `prisma/schema.prisma`, not `databases/turso/prisma/schema.prisma`,
  # and the extracted workspace should match. `git archive <sha>:<subpath>`
  # uses a tree-ish reference that treats the subpath as the archive root,
  # producing entries without the prefix. Smoke3's schema-then-query pilot
  # failure was the prefix-preserved variant masking the fixture's actual
  # shape.
  if [ "$sub" = "." ]; then
    ( cd "$repo_cache" && git archive --format=tar "$sha" ) | gzip -n > "$tar_out"
  else
    ( cd "$repo_cache" && git archive --format=tar "${sha}:${sub}" ) | gzip -n > "$tar_out"
  fi

  actual="$(sha256sum "$tar_out" | awk '{print $1}')"
  if [ "$hash" = "pending" ] || [ -z "$hash" ]; then
    echo "→ $id — fetched, sha256=$actual (SOURCES.md has placeholder; update it)"
    PASS=$((PASS+1))
  elif [ "$actual" != "$hash" ]; then
    echo "✗ $id — sha256 mismatch after fetch"
    echo "    recorded: $hash"
    echo "    actual:   $actual"
    FAIL=$((FAIL+1))
  else
    echo "✓ $id — fetched, sha256 matches"
    PASS=$((PASS+1))
  fi
done

echo ""
echo "───────────────────────────────────────────────────────"
if [ "$VERIFY_ONLY" -eq 1 ]; then
  echo "Verify: $PASS matched, $FAIL drifted"
else
  echo "Fetch:  $PASS ok, $FAIL failed"
fi
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
