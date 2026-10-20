#!/bin/sh
# Runs this work's new regressions against the starting harness, 28efda8d6 (the head of
# fix/requirement-coverage-and-verification-reserve before this work): a detached worktree of that
# commit is given the tested commit's test files and fixtures (nothing else of the harness), so the
# runner under test, its modules and its schema are the starting ones. Usage, from the repository
# root:
#   sh docs/evidence/2026-10-19/endpoint-readiness-trial/regressions-before.sh <scratch dir> <tested commit>
set -u
scratch=$1
tested=$2
before=28efda8d6
git worktree add --detach "$scratch/before" "$before" >/dev/null 2>&1 || exit 2
ln -s "$PWD/node_modules" "$scratch/before/node_modules"
for file in scripts/comparison/run.test.mjs scripts/comparison/inference.test.mjs \
  scripts/comparison/stall.test.mjs scripts/comparison/fixtures/endpoint-server.mjs \
  scripts/comparison/fixtures/arm.mjs; do
  git show "$tested:$file" > "$scratch/before/$file"
done
cd "$scratch/before" || exit 2
run() { echo "=== $1 -t \"$2\""; npx vitest run "$1" -t "$2" 2>&1 | grep -E "^\s+(✓|×)|Tests |Test Files|Error: Cannot find|Failed to load|does not provide an export|Failed to resolve import" | sed 's/ [0-9]*ms$//'; }
run scripts/comparison/inference.test.mjs ""
run scripts/comparison/stall.test.mjs ""
run scripts/comparison/run.test.mjs "readiness before dispatch and a request that stalls during a launch"
cd - >/dev/null && git worktree remove --force "$scratch/before"
