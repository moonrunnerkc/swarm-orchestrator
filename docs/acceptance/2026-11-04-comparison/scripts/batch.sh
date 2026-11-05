#!/bin/bash
# Phase 3, one job at a time after the Phase 2 batch: the four Swarm runs on Ollama (started by the
# Phase 2 batch with OLLAMA_NO_CLOUD=1), then Ollama stopped, then the four Claude Code patches
# judged by the same judge.sh. Not edited once started.
set -u
P=/Users/brad/projects/recovery-2026-10-31/run-comparison/p3
log=$P/batch.log
stamp() { date -u +%FT%TZ; }
curl -s localhost:11434/api/version > /dev/null || { OLLAMA_NO_CLOUD=1 ollama serve > "$P/ollama-serve.log" 2>&1 & sleep 5; }
for t in fix-claimcheck feature-pubprep refactor-ironroot upgrade-claimcheck; do
  echo "$(stamp) start swarm $t" >> "$log"
  "$P/swarm-run.sh" "$t" >> "$log" 2>&1
  curl -s localhost:11434/api/ps >> "$log" 2>&1; echo >> "$log"
  echo "$(stamp) end swarm $t" >> "$log"
done
for m in $(curl -s localhost:11434/api/ps | python3 -c 'import json,sys; [print(m["name"]) for m in json.load(sys.stdin).get("models",[])]'); do
  curl -s localhost:11434/api/generate -d "{\"model\":\"$m\",\"keep_alive\":0}" > /dev/null
done
pkill -f "ollama serve"; echo "$(stamp) ollama stopped" >> "$log"
for t in fix-claimcheck feature-pubprep refactor-ironroot upgrade-claimcheck; do
  echo "$(stamp) start judge claude $t" >> "$log"
  "$P/claude-finish.sh" "$t" >> "$log" 2>&1
  echo "$(stamp) end judge claude $t" >> "$log"
done
echo "$(stamp) phase 3 batch done" >> "$log"
