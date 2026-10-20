#!/bin/sh
# Runs this work's new tool-feedback cases against the starting implementation, 3cdfc34b9 (the head
# of fix/requirement-coverage-and-verification-reserve before this work, PR #90's head): a detached
# worktree of that commit is given the tested commit's three test files and nothing else, so the
# tracker, the loop and the chokepoint under test are the starting ones. Usage, from the repository root:
#   sh docs/evidence/2026-10-20/repair-handoff/regressions-before.sh <scratch dir> <tested commit>
set -u
scratch=$1
tested=$2
before=3cdfc34b9
git worktree add --detach "$scratch/before" "$before" >/dev/null 2>&1 || exit 2
ln -s "$PWD/node_modules" "$scratch/before/node_modules"
for file in src/core/tool-stall.test.ts src/core/loop.test.ts src/agent-run.test.ts; do
  git show "$tested:$file" > "$scratch/before/$file"
done
cd "$scratch/before" || exit 2
run() { echo "=== $1 -t \"$2\""; npx vitest run "$1" -t "$2" 2>&1 | grep -E "^\s+(✓|×)|Tests |Test Files|AssertionError|Expected|Received|expected .* to|^\s+- |^\s+\+ " | sed 's/ [0-9]*ms$//' | head -60; }
run src/core/tool-stall.test.ts "a repeated call that may write"
run src/core/loop.test.ts "tells a repeated successful write"
run src/agent-run.test.ts "a call repeated after a shell command that edited a file"
cd - >/dev/null && git worktree remove --force "$scratch/before"
