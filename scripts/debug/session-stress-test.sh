#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${1:-stress-test-001-$(date -u +%Y%m%dT%H%M%SZ)}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$ROOT_DIR/runs/session-stress-test/$SESSION_NAME"
WORK_DIR="$ARTIFACT_DIR/workspace"
TRANSCRIPT="$ARTIFACT_DIR/transcript.md"
TIMINGS="$ARTIFACT_DIR/timings.tsv"
SUMMARY="$ARTIFACT_DIR/summary.md"
WAIT_SECONDS="${STRESS_WAIT_SECONDS:-180}"
CHECKPOINT_TIMEOUT_SECONDS="${STRESS_CHECKPOINT_TIMEOUT_SECONDS:-180}"
MAX_FIRST_OUTPUT_LATENCY_MS="${STRESS_MAX_FIRST_OUTPUT_LATENCY_MS:-5000}"

mkdir -p "$WORK_DIR"
cat > "$WORK_DIR/package.json" <<'JSON'
{"type":"commonjs","scripts":{"test":"node --check src/config-parser.js"}}
JSON
mkdir -p "$WORK_DIR/src"

log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

if ! command -v copilot >/dev/null 2>&1; then
  echo "copilot CLI not found; install GitHub Copilot CLI before running P0.5" >&2
  exit 127
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "timeout command not found; install coreutils before running P0.5" >&2
  exit 127
fi

if ! copilot --help | grep -q -- '--name' || ! copilot --help | grep -q -- '--resume'; then
  echo "copilot CLI does not expose --name and --resume; P0.5 cannot use Copilot" >&2
  exit 2
fi

cat > "$TRANSCRIPT" <<EOF
# Named-session stress test transcript

Session: $SESSION_NAME
CLI: $(copilot --version 2>/dev/null || echo copilot)
Workspace: $WORK_DIR
Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)

EOF
printf 'checkpoint\tstarted_at\tended_at\telapsed_ms\tfirst_output_latency_ms\tmode\tprobe\n' > "$TIMINGS"

log "P0.5 stress test started: session=$SESSION_NAME"
log "Artifacts: $ARTIFACT_DIR"
log "Wait between checkpoints: ${WAIT_SECONDS}s"
log "Checkpoint timeout: ${CHECKPOINT_TIMEOUT_SECONDS}s"
log "First output latency threshold: ${MAX_FIRST_OUTPUT_LATENCY_MS}ms"

write_summary() {
  {
    echo "# Named-session stress test summary"
    echo
    echo "Session: $SESSION_NAME"
    echo "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "## Timings"
    echo
    echo '```tsv'
    cat "$TIMINGS"
    echo '```'
    echo
    echo "## Artifact paths"
    echo
    echo "- Transcript: $TRANSCRIPT"
    echo "- Workspace: $WORK_DIR"
  } > "$SUMMARY"
}

trap write_summary EXIT

run_checkpoint() {
  local checkpoint="$1"
  local mode="$2"
  local prompt="$3"
  local output_file="$ARTIFACT_DIR/checkpoint-$checkpoint.out"
  local first_ms_file="$ARTIFACT_DIR/checkpoint-$checkpoint.first-ms"
  local start_iso end_iso start_ms first_ms end_ms elapsed_ms resume_latency_ms probe status

  start_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_ms="$(date +%s%3N)"
  : > "$first_ms_file"

  log "checkpoint $checkpoint starting ($mode)"

  if [[ "$mode" == "name" ]]; then
    (
      cd "$WORK_DIR"
      timeout "$CHECKPOINT_TIMEOUT_SECONDS" copilot --name "$SESSION_NAME" --allow-all-tools --allow-all-paths --no-color --silent --stream on -p "$prompt"
    ) 2>&1 | while IFS= read -r line; do
      if [[ ! -s "$first_ms_file" ]]; then
        date +%s%3N > "$first_ms_file"
      fi
      printf '%s\n' "$line"
    done > "$output_file"
    status="${PIPESTATUS[0]}"
  else
    (
      cd "$WORK_DIR"
      timeout "$CHECKPOINT_TIMEOUT_SECONDS" copilot --resume "$SESSION_NAME" --allow-all-tools --allow-all-paths --no-color --silent --stream on -p "$prompt"
    ) 2>&1 | while IFS= read -r line; do
      if [[ ! -s "$first_ms_file" ]]; then
        date +%s%3N > "$first_ms_file"
      fi
      printf '%s\n' "$line"
    done > "$output_file"
    status="${PIPESTATUS[0]}"
  fi

  if [[ "$status" != "0" ]]; then
    echo "copilot checkpoint $checkpoint failed; see $output_file" >&2
    exit "$status"
  fi

  end_ms="$(date +%s%3N)"
  end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  elapsed_ms=$((end_ms - start_ms))
  if [[ -s "$first_ms_file" ]]; then
    first_ms="$(cat "$first_ms_file")"
    resume_latency_ms=$((first_ms - start_ms))
  else
    resume_latency_ms=-1
  fi

  if grep -Eiq 'parseConfig|nested YAML|src/config-parser\.js|ConfigParserOptions|preserve dotted keys|checkpoint-[0-9] marker' "$output_file"; then
    probe="pass"
  else
    probe="fail"
  fi

  log "checkpoint $checkpoint done: elapsed=${elapsed_ms}ms first_output=${resume_latency_ms}ms probe=$probe"

  {
    echo "## Checkpoint $checkpoint"
    echo
    echo "Started: $start_iso"
    echo "Ended: $end_iso"
    echo "Elapsed ms: $elapsed_ms"
    echo "First output latency ms: $resume_latency_ms"
    echo "Mode: $mode"
    echo "Probe: $probe"
    echo
    echo "Prompt:"
    echo
    echo '```text'
    printf '%s\n' "$prompt"
    echo '```'
    echo
    echo "Output:"
    echo
    echo '```text'
    cat "$output_file"
    echo '```'
    echo
  } >> "$TRANSCRIPT"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$checkpoint" "$start_iso" "$end_iso" "$elapsed_ms" "$resume_latency_ms" "$mode" "$probe" >> "$TIMINGS"

  if [[ "$mode" == "resume" && ("$resume_latency_ms" -lt 0 || "$resume_latency_ms" -gt "$MAX_FIRST_OUTPUT_LATENCY_MS") ]]; then
    log "checkpoint $checkpoint failed latency gate: ${resume_latency_ms}ms > ${MAX_FIRST_OUTPUT_LATENCY_MS}ms"
    echo "checkpoint $checkpoint failed latency gate: ${resume_latency_ms}ms > ${MAX_FIRST_OUTPUT_LATENCY_MS}ms" > "$ARTIFACT_DIR/halt-reason.txt"
    return 3
  fi
}

wait_between_checkpoints() {
  local remaining="$WAIT_SECONDS"
  while [[ "$remaining" -gt 0 ]]; do
    log "waiting ${remaining}s before next checkpoint"
    if [[ "$remaining" -gt 30 ]]; then
      sleep 30
      remaining=$((remaining - 30))
    else
      sleep "$remaining"
      remaining=0
    fi
  done
}

run_checkpoint 1 name "In this temporary workspace, create src/config-parser.js with a CommonJS function named parseConfig. It should read a YAML-like config file path, parse simple key: value pairs, and export parseConfig. Record this design decision in your response: function parseConfig, file src/config-parser.js, CommonJS export. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 2 resume "Resume the same named session. Extend the existing parseConfig function in src/config-parser.js to handle nested YAML keys using indentation. Keep the same function name. Add a checkpoint-2 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 3 resume "Resume the same named session. Add support for dotted keys such as database.host while preserving the existing parseConfig function name and src/config-parser.js file. Add a checkpoint-3 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 4 resume "Resume the same named session. Add number and boolean coercion to parseConfig. Keep CommonJS exports and src/config-parser.js. Add a checkpoint-4 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 5 resume "Resume the same named session. Add a ConfigParserOptions object pattern documented in code comments, with preserve dotted keys as an option. Keep parseConfig and src/config-parser.js. Add a checkpoint-5 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 6 resume "Resume the same named session. Add clear thrown errors for missing files and malformed indentation. Keep parseConfig and src/config-parser.js. Add a checkpoint-6 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 7 resume "Resume the same named session. Add a small sample config file examples/sample-config.yml and mention how parseConfig reads it. Keep the existing design decisions. Add a checkpoint-7 marker comment. Do not edit files outside this workspace."
wait_between_checkpoints
run_checkpoint 8 resume "Resume the same named session. Summarize every function name, file name, and design decision you made across all 8 checkpoints. Include parseConfig, src/config-parser.js, CommonJS export, nested YAML keys, dotted keys, type coercion, ConfigParserOptions, preserve dotted keys, missing-file errors, malformed-indentation errors, examples/sample-config.yml, and checkpoint marker comments if you remember them. Do not edit files outside this workspace."

write_summary

cat "$SUMMARY"
