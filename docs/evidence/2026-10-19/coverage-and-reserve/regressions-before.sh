#!/bin/sh
# Runs this work's new regressions against the previous implementation, PR #89's head 9db7ec3d4:
# a detached worktree of that commit is given this branch's test files (nothing else), and only
# the new tests are selected by name. A test whose module or export does not exist there fails at
# import, which is a failure of the previous implementation too. Usage, from the repository root:
#   sh docs/evidence/2026-10-19/coverage-and-reserve/regressions-before.sh <scratch dir> <tested commit>
set -u
scratch=$1
tested=$2
before=9db7ec3d44905d2b1db8ac6fe1374adbba80d1ee
git worktree add --detach "$scratch/before" "$before" >/dev/null 2>&1 || exit 2
ln -s "$PWD/node_modules" "$scratch/before/node_modules"
for file in src/cli-planned-checks.test.ts src/cli-plan-checks.test.ts src/cli-task-contract.test.ts \
  src/cli-run-outcome.test.ts src/cli-planned-checks.integration.test.ts src/tools/output-view.test.ts \
  src/tools/recorded-output-tool.test.ts src/agent-run.test.ts src/core/loop.test.ts \
  src/cli-run-settings.test.ts src/cli-goal-budgets.integration.test.ts; do
  git show "$tested:$file" > "$scratch/before/$file"
done
cd "$scratch/before" || exit 2
run() { echo "=== $1 -t \"$2\""; npx vitest run "$1" -t "$2" 2>&1 | grep -E "^\s+(✓|×)|Tests |Error: Cannot find|is not a function|does not provide an export" | sed 's/ [0-9]*ms$//'; }
run src/cli-planned-checks.test.ts "a preserve check the base fails"
run src/cli-plan-checks.test.ts "a requirement whose only generated check is rejected"
run src/cli-task-contract.test.ts "generated check covers|every planned requirement has a check"
run src/cli-run-outcome.test.ts "the reason planning recorded"
run src/cli-planned-checks.integration.test.ts "a requested outcome the task describes as kept"
run src/tools/output-view.test.ts ""
run src/tools/recorded-output-tool.test.ts ""
run src/agent-run.test.ts "a verbose command in the worker's loop|the gates after a loop that spent its wall"
run src/core/loop.test.ts "past its own wall"
run src/cli-run-settings.test.ts ""
run src/cli-goal-budgets.integration.test.ts "final checks' share|cancelling a goal run"
cd - >/dev/null && git worktree remove --force "$scratch/before"
