#!/bin/bash
# Replays one recorded session's model replies through the 17.0.0 loop (frozen at orch-B), the
# check author live on Ollama, on a fresh clone at the session's base, on the host.
# Usage: replay.sh <session-id> <repo> <setup> <out-dir>
set -u
T=/Users/brad/projects/recovery-2026-10-31/trial-17
sid=$1 repo=$2 setup=$3 out=$4
[ -e "$out" ] && { echo "exists: $out" >&2; exit 4; }
mkdir -p "$out"
python3 - "$sid" "$out" <<'PY'
import json,sys,os
sid,out=sys.argv[1:]; d=os.path.expanduser(f'~/.swarm/sessions/{sid}')
recs=[json.loads(l) for l in open(f'{d}/ledger.jsonl')]
def payload(r): return json.load(open(f"{d}/blobs/{r['payloadDigest'].split(':')[1]}.json"))
start=payload(next(r for r in recs if r['type']=='session-started'))
replies=[p['reply'] for p in map(payload,[r for r in recs if r['type']=='model-call']) if 'review' not in p]
stop=[payload(r) for r in recs if r['type']=='session-stopped']
json.dump(replies,open(f'{out}/replies.json','w'))
open(f'{out}/task.txt','w').write(start['task'])
open(f'{out}/base.txt','w').write(start['head'])
json.dump({'session':sid,'model':start['model'],'replies':len(replies),'stop':stop[0]['stop'] if stop else None,'reason':stop[0].get('reason') if stop else None,'state':stop[0].get('state') if stop else None},open(f'{out}/recorded.json','w'),indent=1)
PY
base=$(cat "$out/base.txt")
git clone -q "/Users/brad/projects/$repo" "$out/$repo" && cd "$out/$repo" && git checkout -q "$base" || exit 3
git config user.email bradkinnard@proton.me; git config user.name moonrunnerkc
git remote set-url --push origin refused-by-the-acceptance-driver
bash -c "$setup" > "$out/setup.log" 2>&1; echo "setup exit $?" >> "$out/setup.log"
port=$((18000 + RANDOM % 1000))
node "$T/replay-stub.mjs" "$out/replies.json" "$port" http://localhost:11434/v1 gemma4:31b "$out/stub.log" &
stub=$!
sleep 1
start=$(date +%s)
SWARM_HOME="$out/home" node "$T/orch-B/src/cli.ts" run "$(cat "$out/task.txt")" --endpoint "http://127.0.0.1:$port/v1" --model replay --approve auto --host --max-steps 60 --max-minutes 60 > "$out/run.out" 2> "$out/run.err"
echo "exit $?" >> "$out/run.out"
echo "wall_seconds $(( $(date +%s) - start ))" > "$out/wall.txt"
kill $stub
report=$(awk '$1=="report"{print $2}' "$out/run.out")
cp "${report%.md}.json" "$out/report.json" 2>/dev/null
echo "replayed $sid: $(grep -E '^(stop|state) ' "$out/run.out" | tr '\n' ' ')"
