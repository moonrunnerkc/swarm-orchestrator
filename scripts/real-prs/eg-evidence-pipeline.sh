#!/usr/bin/env bash
# Orchestrated, resumable evidence run for the execution-grounded layer.
# Phase 1: probe viability fast (1 PR per repo, regression).
# Phase 2: derive viability, then run the regression corpus in full
#          (red repos auto-skip once viability.json exists).
# Phase 3: re-derive viability, run the clean corpus scoped to the
#          non-red repos for the F_clean burden.
# Phase 4: re-derive viability and correlate -> correlation.json.
#
# Resumable: every PR with an existing result.json is skipped, so a kill
# and relaunch picks up where it left off. Heavy; expect hours on a cold run.
set -uo pipefail
cd "$(dirname "$0")/../.."

export SWARM_EG_NODE_BIN=/opt/homebrew/opt/node@22/bin
export SWARM_EG_INSTALL_TIMEOUT_MS="${SWARM_EG_INSTALL_TIMEOUT_MS:-480000}"
export SWARM_EG_WALLCLOCK_MS="${SWARM_EG_WALLCLOCK_MS:-600000}"
# Both corpora are sampled per-repo, not run as a census. M (mutation
# survivors on revert-changed lines) comes only from the mutation-viable repos
# (trpc 1 PR, TanStack 2 PRs), all covered at any cap >= 2; R/U need each repo
# sampled; F_clean is a per-PR mean a documented sample satisfies. Sizes are
# reported in the final report.
REG_MAX_PER_REPO="${REG_MAX_PER_REPO:-2}"
CLEAN_MAX_PER_REPO="${CLEAN_MAX_PER_REPO:-3}"

RUN=dist/scripts/real-prs/run-execution-grounded.js
VIA=dist/scripts/real-prs/derive-stryker-viability.js
COR=dist/scripts/real-prs/correlate-execution-grounded.js
VIAFILE=benchmarks/regression-corpus/stryker-viability.json

say() { echo "===[eg-pipeline $(date +%H:%M:%S)]=== $*"; }

# Repos that are not red in the current viability file, comma-joined.
non_red_repos() {
  node -e '
    const fs=require("fs");
    const f="'"$VIAFILE"'";
    if(!fs.existsSync(f)){process.stdout.write("");process.exit(0);}
    const v=JSON.parse(fs.readFileSync(f,"utf8"));
    const slugs=Object.entries(v).filter(([k,x])=>x.status!=="red").map(([k])=>k);
    process.stdout.write(slugs.join(","));
  '
}

say "PHASE 1: viability probe (1 PR/repo, regression)"
SWARM_EG_CORPUS=regression SWARM_EG_MAX_PER_REPO=1 node "$RUN"

say "PHASE 2: derive viability + regression run capped at ${REG_MAX_PER_REPO}/repo (red repos auto-skip)"
node "$VIA"
SWARM_EG_CORPUS=regression SWARM_EG_MAX_PER_REPO="$REG_MAX_PER_REPO" node "$RUN"

say "PHASE 3: re-derive viability + clean corpus on non-red repos"
node "$VIA"
SCOPE="$(non_red_repos)"
say "clean-corpus scope: ${SCOPE:-<none>}"
if [ -n "$SCOPE" ]; then
  SWARM_EG_CORPUS=clean SWARM_EG_REPOS="$SCOPE" SWARM_EG_MAX_PER_REPO="$CLEAN_MAX_PER_REPO" node "$RUN"
else
  say "no non-red repos; skipping clean corpus"
fi

say "PHASE 4: final viability + correlation"
node "$VIA"
node "$COR"

say "DONE. headline:"
node -e 'const c=require("./benchmarks/regression-corpus/execution-grounded/correlation.json"); console.log(JSON.stringify(c.headline,null,2));' 2>/dev/null || say "no correlation.json"
