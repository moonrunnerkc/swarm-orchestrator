#!/bin/bash
# Usage: capture.sh <orchestrator-dir> <label> <port>
set -u
P=/Users/brad/projects/recovery-2026-10-31/trial-17
orch=$1 label=$2 port=$3
out=$P/prefill/$label
rm -rf "$out"; mkdir -p "$out"
git clone -q $P/pubprep-base "$out/pubprep" && git -C "$out/pubprep" checkout -q 99d8d054753b4e8979431eb58792895c754fbdc9
cp -cR $P/pubprep-base/node_modules "$out/pubprep/node_modules"
node $P/capture-stub.mjs $P/prefill/replies.json $port "$out/bodies.jsonl" &
stub=$!
for _ in $(seq 1 50); do [ -f "$out/bodies.jsonl.ready" ] && break; sleep 0.2; done
(cd "$out/pubprep" && SWARM_HOME="$out/home" node "$orch/src/cli.ts" run "$(cat $P/prefill/task.txt)" --endpoint "http://127.0.0.1:$port/v1" --model replay --approve auto --host --max-steps 14 > "$out/run.out" 2> "$out/run.err")
kill $stub
echo "$label: $(wc -l < "$out/bodies.jsonl") prompts; $(grep -E '^stop ' "$out/run.out")"
