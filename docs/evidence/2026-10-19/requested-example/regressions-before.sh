#!/bin/sh
# Runs this work's new regressions against the starting implementation, 544f643a3 (the head of
# fix/requirement-coverage-and-verification-reserve before this work): a detached worktree of that
# commit is given the tested commit's test files (nothing else), and only the new or changed tests
# are selected by name. Usage, from the repository root:
#   sh docs/evidence/2026-10-19/requested-example/regressions-before.sh <scratch dir> <tested commit>
set -u
scratch=$1
tested=$2
before=544f643a3
git worktree add --detach "$scratch/before" "$before" >/dev/null 2>&1 || exit 2
ln -s "$PWD/node_modules" "$scratch/before/node_modules"
for file in src/workers/planned-check-program.test.ts src/cli-planned-checks.test.ts \
  src/cli-plan-checks.test.ts src/gates/auto-resolve.test.ts src/cli-task-contract.test.ts \
  src/cli-run-outcome.test.ts src/cli-outcome-follow-up.test.ts \
  src/cli-planned-checks.integration.test.ts; do
  git show "$tested:$file" > "$scratch/before/$file"
done
cd "$scratch/before" || exit 2
run() { echo "=== $1 -t \"$2\""; npx vitest run "$1" -t "$2" 2>&1 | grep -E "^\s+(✓|×)|Tests |Error: Cannot find|is not a function|does not provide an export|Failed to load" | sed 's/ [0-9]*ms$//'; }
run src/workers/planned-check-program.test.ts "keeps every version of a check that stated it"
run src/cli-planned-checks.test.ts "asserts on the project's answer|takes the base's answer for an input the task names"
run src/cli-plan-checks.test.ts "takes the base's answer for the task's own input|moves its check off the task's own input|wrong expectation is corrected|declared again with its words kept|declared again with words dropped|two behaviours one quote|launch's 64 s|borrowing the 32 s|exactly at the limit|stops the first round after a base run"
run src/gates/auto-resolve.test.ts "a follow-up owed on work no gate measures"
run src/cli-task-contract.test.ts "names the task's own input"
run src/cli-run-outcome.test.ts "says whether the follow-up"
run src/cli-outcome-follow-up.test.ts ""
run src/cli-planned-checks.integration.test.ts "a worker that finishes with a requested outcome unresolved|admits checks by their base control and repairs"
cd - >/dev/null && git worktree remove --force "$scratch/before"
