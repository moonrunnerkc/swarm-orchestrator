#!/bin/sh
# Runs this work's new regressions against the starting implementation, 3e99b6305 (the head of
# fix/requirement-coverage-and-verification-reserve before this work): a detached worktree of that
# commit is given the tested commit's test files (nothing else), and only the new tests are
# selected by name. Usage, from the repository root:
#   sh docs/evidence/2026-10-19/outcome-coverage/regressions-before.sh <scratch dir> <tested commit>
set -u
scratch=$1
tested=$2
before=3e99b6305
git worktree add --detach "$scratch/before" "$before" >/dev/null 2>&1 || exit 2
ln -s "$PWD/node_modules" "$scratch/before/node_modules"
for file in src/workers/planned-check-program.test.ts src/cli-planned-checks.test.ts \
  src/cli-plan-checks.test.ts src/cli-task-contract.test.ts src/cli-run-outcome.test.ts \
  src/cli-planned-checks.integration.test.ts; do
  git show "$tested:$file" > "$scratch/before/$file"
done
cd "$scratch/before" || exit 2
run() { echo "=== $1 -t \"$2\""; npx vitest run "$1" -t "$2" 2>&1 | grep -E "^\s+(✓|×)|Tests |Error: Cannot find|is not a function|does not provide an export" | sed 's/ [0-9]*ms$//'; }
run src/workers/planned-check-program.test.ts "names a case thrown"
run src/cli-planned-checks.test.ts "a case that throws on the base"
run src/cli-plan-checks.test.ts "keeps an outcome unresolved|names a revision whose allowance ended"
run src/cli-task-contract.test.ts "names an unresolved outcome"
run src/cli-run-outcome.test.ts "scopes an accepted run"
run src/cli-planned-checks.integration.test.ts "beside a checked sibling"
cd - >/dev/null && git worktree remove --force "$scratch/before"
