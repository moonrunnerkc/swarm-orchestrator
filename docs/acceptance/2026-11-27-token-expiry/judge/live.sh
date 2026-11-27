#!/bin/bash
# One live expiry run: a packed install, a real local model, the automatic path only.
#   live.sh <install dir> <run name> [model]
# The acceptance test and the security binding are the ones Swarm drafts itself
# (--accept-authored): no --accept, no --security-check. The base is examples/invites-api, whose
# missing expiry enforcement is a labeled seeded fault; its hand-written binding is removed first.
set -u
W=/Users/brad/projects/recovery-2026-10-31/run-expiry
EX=/Users/brad/projects/recovery-2026-10-31/wt/assure/examples
install=$1 name=$2 model=${3:-gemma4:31b}
dir=$W/runs/$name
[ -e "$dir" ] && { echo "exists: $dir" >&2; exit 4; }
mkdir -p "$dir" && cp -R "$EX/invites-api" "$dir/repo" && cd "$dir/repo" || exit 3
rm -f security.json README.md   # the hand-written binding and the page that names the fault stay out
git init -q -b main && git config user.email bradkinnard@proton.me && git config user.name moonrunnerkc && git add -A && git commit -qm "base (invites, seeded missing expiry)"
export SWARM_HOME=$dir/home
export SWARM_SIGNING_KEY="$(cat /Users/brad/projects/recovery-2026-10-31/run-closeout/signing-key.pem)"
swarm=$install/node_modules/.bin/swarm
flags="--accept-authored --no-security ownership --approve auto --max-steps 40 --max-minutes 40 --no-apply"
{
  echo "model $model"; echo "swarm $($swarm --version)"; echo "verifier $($install/node_modules/.bin/swarm-verify --version)"
  echo "base $(git rev-parse HEAD)"; echo "task $(cat task.txt)"; echo "flags $flags"
} > "$dir/start.txt"
start=$(date +%s)
$swarm run "$(cat task.txt)" $flags --model "$model" > "$dir/run.out" 2> "$dir/run.err"
echo "exit $?" >> "$dir/run.out"
echo "wall_seconds $(( $(date +%s) - start ))" > "$dir/wall.txt"
session=$(awk '$1=="evidence"{print $2}' "$dir/run.out")
report=$(awk '$1=="report"{print $2}' "$dir/run.out")
cp "$report" "$dir/report.md" 2>/dev/null; cp "${report%.md}.json" "$dir/report.json" 2>/dev/null
patch=$(awk '$1=="patch"{print $2}' "$dir/run.out"); cp "$patch" "$dir/patch.diff" 2>/dev/null
cp "$session/security.json" "$dir/drafted-security.json" 2>/dev/null
attestation=$(awk '$1=="attestation"{print $2}' "$dir/run.out"); key=$(awk '$1=="key"{print $2}' "$dir/run.out")
if [ -n "$attestation" ]; then "$install/node_modules/.bin/swarm-verify" replay "$(dirname "$attestation")" --key "$key" --workspace "$dir/repo" > "$dir/replay.out" 2>&1; echo "exit $?" >> "$dir/replay.out"; else echo "no attestation" > "$dir/replay.out"; fi
node "$W/judge.mjs" "$install" "$dir" > "$dir/judge.out" 2>&1
echo "$name: self $(awk '$1=="state"{print $2}' "$dir/run.out"); $(cat "$dir/wall.txt"); $(grep -m1 '^verdict' "$dir/judge.out")"
