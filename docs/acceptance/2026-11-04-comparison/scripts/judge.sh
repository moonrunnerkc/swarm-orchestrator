#!/bin/bash
# Judges one patch against a comparison task's sealed criteria, the same way for every agent:
# a fresh clone of the read-only repository at the task's base, the held-out files copied in and
# sealed from a swarm.toml whose only test check is the held-out command, then the task's
# judge.toml as swarm.toml, swarm-verify verify (isolated, dependencies prepared) with the task's
# requirements.json, and swarm-verify replay. The source repository's refs are compared before
# and after.
# Usage: judge.sh <task-dir> <patch-file> <out-dir>. Not edited once started.
set -u
RUN=/Users/brad/projects/recovery-2026-10-31/run-comparison
SV=$RUN/bin/sv
task=$1 patch=$2 out=$3
[ -e "$out" ] && { echo "exists: $out" >&2; exit 4; }
repo=$(awk -F'[ (]' '/^- Repository:/{print $3}' "$task/criteria.md")
base=$(awk -F'`' '/^- Base:/{print $2}' "$task/criteria.md")
held=$(sed -n 's/^`held-out = { command = "\(.*\)", kind = "test" }`.*/\1/p' "$task/criteria.md")
glob=$(sed -n "s/^Sealed with \`swarm-verify init --seal '\(.*\)'\` from.*/\1/p" "$task/criteria.md")
src=/Users/brad/projects/$repo
[ -n "$repo" ] && [ -n "$base" ] && [ -n "$held" ] && [ -n "$glob" ] || { echo "criteria unreadable: repo=$repo base=$base held=$held glob=$glob" >&2; exit 3; }
mkdir -p "$out/home" || exit 3
refs() { git -C "$src" for-each-ref --format='%(refname) %(objectname)'; git -C "$src" stash list; git -C "$src" status --short; git -C "$src" worktree list; }
refs > "$out/source-before.txt"
printf 'task %s\nrepo %s\nbase %s\nheld-out %s\nseal %s\npatch %s sha256 %s\nverifier %s\n' "$task" "$repo" "$base" "$held" "$glob" "$patch" "$(shasum -a 256 "$patch" | cut -d' ' -f1)" "$("$SV" --version 2>&1)" > "$out/start.txt"
git clone -q "$src" "$out/$repo" && cd "$out/$repo" && git checkout -q "$base" || exit 3
cp -R "$task/held-out/." .
printf '[checks]\nheld-out = { command = "%s", kind = "test" }\n' "$held" > swarm.toml
export SWARM_HOME=$out/home
"$SV" init --seal "$glob" > "$out/seal.out" 2>&1; echo "exit $?" >> "$out/seal.out"
cp "$task/judge.toml" swarm.toml
git status --short > "$out/judge-clone-status.txt"
"$SV" verify --base "$base" --patch "$patch" --isolation isolated --dependencies prepare --requirements "$task/requirements.json" --out "$out/verdict" > "$out/verify.out" 2>&1
echo "exit $?" >> "$out/verify.out"
"$SV" replay "$out/verdict" --workspace "$out/$repo" > "$out/replay.out" 2>&1
echo "exit $?" >> "$out/replay.out"
python3 -I -c "
import json, sys
p = json.load(open(sys.argv[1]))['predicate']
print('state:', p['state'])
for r in p['requirements']:
    print('requirement', r['id'], r['status'], '|', r.get('limitation'))
base = p['baseline']['heldOut'] if p['baseline']['status'] == 'measured' else None
print('held-out at base:', [(c['name'], c['result']) for c in base or []])
h = p['heldOut']
print('held-out on candidate:', h.get('status'), [(c['name'], c['result']) for c in h.get('checks', [])])
print('regression:', json.dumps(p['regression'])[:300])
print('checks:', [(c['name'], c['result']) for c in p['checks']])
print('unmeasured:', p['unmeasured'])
" "$out/verdict/statement.json" > "$out/result.txt" 2>&1
unset SWARM_HOME
refs > "$out/source-after.txt"
cmp -s "$out/source-before.txt" "$out/source-after.txt" && echo "source repository unchanged" > "$out/source-check.txt" || { echo "SOURCE REPOSITORY CHANGED" > "$out/source-check.txt"; diff "$out/source-before.txt" "$out/source-after.txt" >> "$out/source-check.txt"; }
echo "judged $(basename "$task") $(basename "$out"): $(head -1 "$out/result.txt"); replay $(tail -1 "$out/replay.out"); $(cat "$out/source-check.txt" | head -1)"
