#!/bin/bash
# After the Claude Code side's attempt: its patch against the base (untracked files included,
# dependency directories excluded), the source repository check, then judge.sh.
# Usage: claude-finish.sh <task-name>. Not edited once started.
set -u
ROOT=/Users/brad/projects/recovery-2026-10-31
C=$ROOT/swarm-orchestrator/docs/acceptance/2026-11-04-comparison
name=$1
task=$C/$name
repo=$(awk -F'[ (]' '/^- Repository:/{print $3}' "$task/criteria.md")
base=$(awk -F'`' '/^- Base:/{print $2}' "$task/criteria.md")
dir=$ROOT/comparison/$name/claude
src=/Users/brad/projects/$repo
git -C "$dir/$repo" add -N . && git -C "$dir/$repo" diff "$base" -- . ':!.venv' ':!node_modules' ':!dist' > "$dir/patch.diff"
{ git -C "$src" for-each-ref --format='%(refname) %(objectname)'; git -C "$src" status --short; } > "$dir/source-after.txt"
cmp -s "$dir/source-before.txt" "$dir/source-after.txt" && echo "source repository unchanged" > "$dir/source-check.txt" || { echo "SOURCE REPOSITORY CHANGED" > "$dir/source-check.txt"; diff "$dir/source-before.txt" "$dir/source-after.txt" >> "$dir/source-check.txt"; }
"$ROOT/run-comparison/p3/judge.sh" "$task" "$dir/patch.diff" "$dir/judged"
