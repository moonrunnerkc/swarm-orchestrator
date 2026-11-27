#!/bin/bash
# One live closeout run: a packed install, a real local model, the automatic path only.
#   live.sh <install dir> <run name> <invoice|notes> <feature|repair> [model]
# The checks are the ones Swarm drafts itself (--accept-authored): no --accept, no --security-check.
# repair: the labeled seeded fault is laid over the example before the base commit.
set -u
W=/Users/brad/projects/recovery-2026-10-31/run-closeout
EX=/Users/brad/projects/recovery-2026-10-31/wt/assure/examples
install=$1 name=$2 example=$3 variant=$4 model=${5:-gemma4:31b}
dir=$W/runs/$name
[ -e "$dir" ] && { echo "exists: $dir" >&2; exit 4; }
mkdir -p "$dir" && cp -R "$EX/$example-api" "$dir/repo" && cd "$dir/repo" || exit 3
rm -f security.json   # the hand-written binding stays out of the repository the run reads
if [ "$variant" = repair ]; then
  [ "$example" = invoice ] || { echo "the seeded fault is for the invoice example" >&2; exit 4; }
  cp "$W/seeded/insecure-app.ts" src/app.ts
  cp "$W/seeded/repair-task.txt" task.txt
fi
sources=$([ "$example" = invoice ] && echo src || echo service)
git init -q -b main && git config user.email bradkinnard@proton.me && git config user.name moonrunnerkc && git add -A && git commit -qm "base ($example, $variant)"
export SWARM_HOME=$dir/home
export SWARM_SIGNING_KEY="$(cat "$W/signing-key.pem")"
swarm=$install/node_modules/.bin/swarm
{
  echo "example $example"; echo "variant $variant"; echo "model $model"
  echo "swarm $($swarm --version)"; echo "verifier $($install/node_modules/.bin/swarm-verify --version)"
  echo "base $(git rev-parse HEAD)"; echo "task $(cat task.txt)"
  echo "flags --accept-authored --approve auto --max-steps 40 --max-minutes 40 --no-apply"
} > "$dir/start.txt"
$swarm init --learn "$sources" > "$dir/learn.out" 2>&1
proposal=$(awk '$1=="proposal"{print $2}' "$dir/learn.out")
cp "$proposal" "$dir/proposal.toml"
$swarm init --approve "$proposal" > "$dir/approve.out" 2>&1
# A separate process, with nothing carried over but the files under SWARM_HOME.
$swarm doctor --conventions > "$dir/conventions.out" 2>&1
start=$(date +%s)
$swarm run "$(cat task.txt)" --accept-authored --model "$model" --approve auto --max-steps 40 --max-minutes 40 --no-apply > "$dir/run.out" 2> "$dir/run.err"
echo "exit $?" >> "$dir/run.out"
echo "wall_seconds $(( $(date +%s) - start ))" > "$dir/wall.txt"
session=$(awk '$1=="evidence"{print $2}' "$dir/run.out")
report=$(awk '$1=="report"{print $2}' "$dir/run.out")
cp "$report" "$dir/report.md" 2>/dev/null; cp "${report%.md}.json" "$dir/report.json" 2>/dev/null
patch=$(awk '$1=="patch"{print $2}' "$dir/run.out"); cp "$patch" "$dir/patch.diff" 2>/dev/null
cp "$session/security.json" "$dir/drafted-security.json" 2>/dev/null
true
attestation=$(awk '$1=="attestation"{print $2}' "$dir/run.out"); key=$(awk '$1=="key"{print $2}' "$dir/run.out")
if [ -n "$attestation" ]; then "$install/node_modules/.bin/swarm-verify" replay "$(dirname "$attestation")" --key "$key" --workspace "$dir/repo" > "$dir/replay.out" 2>&1; echo "exit $?" >> "$dir/replay.out"; else echo "no attestation" > "$dir/replay.out"; fi
node "$W/judge.mjs" "$install" "$dir" "$example" "$variant" > "$dir/judge.out" 2>&1
echo "$name: self $(awk '$1=="state"{print $2}' "$dir/run.out"); $(cat "$dir/wall.txt"); $(grep -m1 '^verdict' "$dir/judge.out")"
