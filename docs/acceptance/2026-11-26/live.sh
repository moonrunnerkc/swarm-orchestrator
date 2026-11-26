#!/bin/bash
# One live run of the invoice example on a packed install, with a real local model.
#   live.sh <install dir> <run name> <feature|repair> <upgraded|baseline>
# upgraded: learn and approve conventions through the CLI, show them from a fresh process, then
#   run with the hand-written security binding. baseline: the same task, model and budgets on the
#   starting version, which has neither.
set -u
R=/Users/brad/projects/recovery-2026-10-31/run-assure
EX=/Users/brad/projects/recovery-2026-10-31/wt/assure/examples/invoice-api
install=$1 name=$2 variant=$3 version=$4
dir=$R/runs/$name
[ -e "$dir" ] && { echo "exists: $dir" >&2; exit 4; }
mkdir -p "$dir" && cp -R "$EX" "$dir/invoice-api" && cd "$dir/invoice-api" || exit 3
if [ "$variant" = repair ]; then
  # Seeded fault, labeled: the download route serves any signed-in user any invoice.
  cp "$R/seeded/insecure-app.ts" src/app.ts
  cp "$R/seeded/repair-task.txt" task.txt
fi
git init -q -b main && git config user.email bradkinnard@proton.me && git config user.name moonrunnerkc && git add -A && git commit -qm "base ($variant)"
export SWARM_HOME=$dir/home
export SWARM_SIGNING_KEY="$(cat "$R/signing-key.pem")"
swarm=$install/node_modules/.bin/swarm
printf 'variant %s\nversion %s\nswarm %s\nverifier %s\nmodel gemma4:31b\nbase %s\n' "$variant" "$version" "$($swarm --version)" "$($install/node_modules/.bin/swarm-verify --version)" "$(git rev-parse HEAD)" > "$dir/start.txt"
# The check for the task itself is the user's own, the same file for both versions.
args=(--accept "$EX-checks/$variant")
if [ "$version" = upgraded ]; then
  $swarm init --learn src > "$dir/learn.out" 2>&1
  proposal=$(awk '$1=="proposal"{print $2}' "$dir/learn.out")
  cp "$proposal" "$dir/proposal.toml"
  $swarm init --approve "$proposal" > "$dir/approve.out" 2>&1
  # A separate process, with nothing carried over but the files under SWARM_HOME.
  $swarm doctor --conventions > "$dir/conventions.out" 2>&1
  args+=(--security-check security.json)
fi
start=$(date +%s)
$swarm run "$(cat task.txt)" "${args[@]}" --model gemma4:31b --approve auto --max-steps 40 --max-minutes 40 --no-apply > "$dir/run.out" 2> "$dir/run.err"
echo "exit $?" >> "$dir/run.out"
echo "wall_seconds $(( $(date +%s) - start ))" > "$dir/wall.txt"
report=$(awk '$1=="report"{print $2}' "$dir/run.out")
cp "$report" "$dir/report.md" 2>/dev/null; cp "${report%.md}.json" "$dir/report.json" 2>/dev/null
patch=$(awk '$1=="patch"{print $2}' "$dir/run.out"); cp "$patch" "$dir/patch.diff" 2>/dev/null
attestation=$(awk '$1=="attestation"{print $2}' "$dir/run.out"); key=$(awk '$1=="key"{print $2}' "$dir/run.out")
if [ -n "$attestation" ]; then "$install/node_modules/.bin/swarm-verify" replay "$(dirname "$attestation")" --key "$key" --workspace "$dir/invoice-api" > "$dir/replay.out" 2>&1; echo "exit $?" >> "$dir/replay.out"; else echo "no attestation" > "$dir/replay.out"; fi
# The evaluation: the same instrument for both versions, on the delivered patch.
if [ -s "$dir/patch.diff" ]; then
  SWARM_HOME=$dir/eval-home node "$R/eval.mjs" "$R/install-c2" "$dir/invoice-api" "$dir/patch.diff" "$R/seeded/binding.json" "$R/seeded/rules.json" "$dir/evaluation" > "$dir/evaluation.out" 2>&1
else echo "no patch delivered" > "$dir/evaluation.out"; fi
echo "$name: self $(awk '$1=="state"{print $2}' "$dir/run.out"); $(cat "$dir/wall.txt"); evaluation $(grep -m1 '"state"' "$dir/evaluation.out")"
