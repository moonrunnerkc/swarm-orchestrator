#!/bin/bash
# The Claude Code side's workspace for one comparison task, prepared exactly as swarm-run.sh
# prepares Swarm's: a fresh clone at the task's base, dependencies installed, push refused, and
# task.md beside it. The agent then works in it from task.md alone.
# Usage: claude-prep.sh <task-name>. Not edited once started.
set -u
ROOT=/Users/brad/projects/recovery-2026-10-31
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
dir=$ROOT/comparison/$name/claude
[ -e "$dir" ] && { echo "exists: $dir" >&2; exit 4; }
mkdir -p "$dir" || exit 3
src=/Users/brad/projects/$repo
git -C "$src" for-each-ref --format='%(refname) %(objectname)' > "$dir/source-before.txt"; git -C "$src" status --short >> "$dir/source-before.txt"
git clone -q "$src" "$dir/$repo" && cd "$dir/$repo" && git checkout -q "$base" || exit 3
git config user.email bradkinnard@proton.me; git config user.name moonrunnerkc
git remote set-url --push origin refused-by-the-acceptance-driver
cp "$task/task.md" "$dir/task.md"
printf 'base %s\nsetup %s\n' "$(git rev-parse HEAD)" "$setup" > "$dir/start.txt"
bash -c "$setup" > "$dir/setup.log" 2>&1; echo "setup exit $?" >> "$dir/setup.log"
echo "$dir/$repo $(tail -1 "$dir/setup.log")"
