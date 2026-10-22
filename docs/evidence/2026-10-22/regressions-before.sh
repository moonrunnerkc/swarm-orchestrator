#!/bin/sh
# Runs this stage's regression tests against the starting implementation (53c2e6b06): the
# self-hosted-runner controls, the rereading-environment case and the repair-brief cases, copied
# into a checkout of that commit. Usage: regressions-before.sh <checkout of 53c2e6b06 with npm ci>
set -u
here=$(cd "$(dirname "$0")/../../.." && pwd)
base=$1
cp "$here/src/cli-ci-self-hosted-runner.integration.test.ts" "$base/src/"
cp "$here/src/gates/independent-verification.test.ts" "$base/src/gates/"
cp "$here/src/gates/unmeasured-change.test.ts" "$base/src/gates/"
cd "$base" && git rev-parse HEAD && npx vitest run src/cli-ci-self-hosted-runner.integration.test.ts \
  src/gates/independent-verification.test.ts src/gates/unmeasured-change.test.ts
status=$?
git checkout -q -- src/gates/independent-verification.test.ts src/gates/unmeasured-change.test.ts
rm -f src/cli-ci-self-hosted-runner.integration.test.ts
exit $status
