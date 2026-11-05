#!/bin/bash
# The Swarm side of one comparison task: a fresh clone of the read-only repository at the task's
# base, its dependencies installed as a user's checkout has them (the same preparation the other
# agent's clone gets), installed swarm 16.0.4 run on task.md with --model auto, replay of its final
# verification, then judge.sh on the delivered patch. The source repository's refs are compared.
# Usage: swarm-run.sh <task-name>. Not edited once started.
set -u
ROOT=/Users/brad/projects/recovery-2026-10-31
RUN=$ROOT/run-comparison
C=$ROOT/swarm-orchestrator/docs/acceptance/2026-11-04-comparison
name=$1
task=$C/$name
repo=$(awk -F'[ (]' '/^- Repository:/{print $3}' "$task/criteria.md")
base=$(awk -F'`' '/^- Base:/{print $2}' "$task/criteria.md")
case $repo in
  claimcheck|pubprep) setup="npm ci --no-audit --no-fund" ;;
  ironroot) setup="uv venv -q -p 3.12 .venv && uv pip install -q -e .[dev]" ;;
  *) echo "no setup for $repo" >&2; exit 2 ;;
esac
src=/Users/brad/projects/$repo
n=1; while [ -e "$ROOT/comparison/$name/swarm/attempt-$n" ]; do n=$((n + 1)); done
dir=$ROOT/comparison/$name/swarm/attempt-$n
mkdir -p "$dir" || exit 3
refs() { git -C "$src" for-each-ref --format='%(refname) %(objectname)'; git -C "$src" stash list; git -C "$src" status --short; git -C "$src" worktree list; }
refs > "$dir/source-before.txt"
git clone -q "$src" "$dir/$repo" && cd "$dir/$repo" && git checkout -q "$base" || exit 3
git config user.email bradkinnard@proton.me; git config user.name moonrunnerkc
git remote set-url --push origin refused-by-the-acceptance-driver
cp "$task/task.md" "$dir/task.md"
printf 'base %s\nsetup %s\nswarm %s\n' "$(git rev-parse HEAD)" "$setup" "$("$RUN/bin/swarm" --version 2>&1)" > "$dir/start.txt"
bash -c "$setup" > "$dir/setup.log" 2>&1; echo "setup exit $?" >> "$dir/setup.log"
git status --short > "$dir/status-before-run.txt"
date -u +%FT%TZ > "$dir/started-at.txt"
start=$(date +%s)
"$RUN/bin/swarm" run "$(cat "$task/task.md")" --model auto --approve auto --max-steps 60 --max-minutes 60 > "$dir/run.out" 2> "$dir/run.err"
echo "exit $?" >> "$dir/run.out"
echo "wall_seconds $(( $(date +%s) - start ))" > "$dir/wall.txt"
date -u +%FT%TZ > "$dir/ended-at.txt"
attestation=$(awk '$1=="attestation"{print $2}' "$dir/run.out")
patch=$(awk '$1=="patch"{print $2}' "$dir/run.out")
if [ -n "$attestation" ]; then
  "$RUN/bin/sv" replay "$(dirname "$attestation")" --workspace "$dir/$repo" > "$dir/replay.out" 2>&1
  echo "exit $?" >> "$dir/replay.out"
else
  echo "no attestation to replay" > "$dir/replay.out"
fi
if [ -n "$patch" ] && [ -s "$patch" ]; then
  cp "$patch" "$dir/patch.diff"
  echo "the delivered patch, $patch" > "$dir/patch-source.txt"
else
  # No delivered patch: judge what the run left in the workspace, untracked files included.
  git -C "$dir/$repo" add -N . && git -C "$dir/$repo" diff "$base" -- . ':!.venv' ':!node_modules' > "$dir/patch.diff"
  echo "no delivered patch; the workspace's diff against the base" > "$dir/patch-source.txt"
fi
refs > "$dir/source-after.txt"
cmp -s "$dir/source-before.txt" "$dir/source-after.txt" && echo "source repository unchanged" > "$dir/source-check.txt" || { echo "SOURCE REPOSITORY CHANGED" > "$dir/source-check.txt"; diff "$dir/source-before.txt" "$dir/source-after.txt" >> "$dir/source-check.txt"; }
if [ -s "$dir/patch.diff" ]; then
  "$RUN/p3/judge.sh" "$task" "$dir/patch.diff" "$dir/judged"
else
  echo "empty patch: nothing to judge" > "$dir/judged.txt"
fi
echo "$name swarm attempt-$n: $(tail -1 "$dir/run.out"); $(cat "$dir/patch-source.txt"); $(head -1 "$dir/source-check.txt")"
