#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# run_fresh.sh — Three-producer benchmark harness
#
# Producers:
#   ORCHESTRATOR — swarm bootstrap (full orchestration)
#   SINGLE_SHOT  — Claude Code CLI, one request, 1 premium request
#   LADDER       — Claude Code CLI, deterministic prompt ladder
#                  up to BUDGET_CAP requests, re-scored after each
#
# Usage:
#   ./run_fresh.sh                           # 8 runs per producer (all)
#   ./run_fresh.sh 24                        # 24 runs per producer
#   PRODUCER=ORCHESTRATOR ./run_fresh.sh 8   # orchestrator only
#   PRODUCER=SINGLE_SHOT  ./run_fresh.sh 8   # single-shot only
#   PRODUCER=LADDER        ./run_fresh.sh 8  # ladder only
#   PRODUCER=ALL           ./run_fresh.sh 24 # all three (default)
#
# D2: Deterministic round-robin — run_index mod task_count.
# D6: Three-producer design enables cost-vs-completeness comparison.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/raw_data/runs"
RUBRIC_TASKS="$SCRIPT_DIR/raw_data/rubric_tasks.json"
LEGACY_TASKS="$SCRIPT_DIR/raw_data/legacy_tasks.json"
SCORE_SCRIPT="$SCRIPT_DIR/scoring/score.sh"
RUBRIC_RUNNER="$SCRIPT_DIR/scoring/rubric_runner.py"
LADDER_SCRIPT="$SCRIPT_DIR/../ladder/run_ladder.sh"
SWARM_BIN="$REPO_ROOT/dist/src/cli.js"
TOOL="${TOOL:-claude-code}"
PRODUCER="${PRODUCER:-ALL}"
TASK_SOURCE="${TASK_SOURCE:-RUBRIC}"   # RUBRIC | CONSTRAINT_BINDING
BUDGET_CAP="${BUDGET_CAP:-30}"

# Parse positional + long flags. TARGET_RUNS is still the first positional arg
# for backwards compatibility.
TARGET_RUNS=""
# Provider-selection flags forwarded verbatim to the orchestrator's
# `swarm run` subprocess. Each is initialized from its env-var counterpart
# so callers can configure either via the flag or via the environment;
# explicit flags override env values when both are set.
EXTRACTOR_PROVIDER="${EXTRACTOR_PROVIDER:-}"
SESSION_PROVIDER="${SESSION_PROVIDER:-}"
LOCAL_LLM_BACKEND="${LOCAL_LLM_BACKEND:-}"
LOCAL_LLM_BASE_URL="${LOCAL_LLM_BASE_URL:-}"
LOCAL_LLM_MODEL_EXTRACTOR="${LOCAL_LLM_MODEL_EXTRACTOR:-}"
LOCAL_LLM_MODEL_SESSION="${LOCAL_LLM_MODEL_SESSION:-}"
LOCAL_LLM_GRAMMAR="${LOCAL_LLM_GRAMMAR:-}"
LOCAL_LLM_API_KEY="${LOCAL_LLM_API_KEY:-}"
LOCAL_LLM_SEED="${LOCAL_LLM_SEED:-}"
LOCAL_LLM_REQUEST_TIMEOUT_MS="${LOCAL_LLM_REQUEST_TIMEOUT_MS:-}"
LOCAL_LLM_MAX_CONCURRENCY="${LOCAL_LLM_MAX_CONCURRENCY:-}"
LOCAL_PERSONA_MODEL_MAP="${LOCAL_PERSONA_MODEL_MAP:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --task-source) TASK_SOURCE="$2"; shift 2 ;;
    --producer)    PRODUCER="$2"; shift 2 ;;
    --tool)        TOOL="$2"; shift 2 ;;
    --budget-cap)  BUDGET_CAP="$2"; shift 2 ;;
    --extractor)                  EXTRACTOR_PROVIDER="$2"; shift 2 ;;
    --session)                    SESSION_PROVIDER="$2"; shift 2 ;;
    --local-backend)              LOCAL_LLM_BACKEND="$2"; shift 2 ;;
    --local-base-url)             LOCAL_LLM_BASE_URL="$2"; shift 2 ;;
    --local-model-extractor)      LOCAL_LLM_MODEL_EXTRACTOR="$2"; shift 2 ;;
    --local-model-session)        LOCAL_LLM_MODEL_SESSION="$2"; shift 2 ;;
    --local-grammar)              LOCAL_LLM_GRAMMAR="$2"; shift 2 ;;
    --local-api-key)              LOCAL_LLM_API_KEY="$2"; shift 2 ;;
    --local-seed)                 LOCAL_LLM_SEED="$2"; shift 2 ;;
    --local-request-timeout-ms)   LOCAL_LLM_REQUEST_TIMEOUT_MS="$2"; shift 2 ;;
    --local-max-concurrency)      LOCAL_LLM_MAX_CONCURRENCY="$2"; shift 2 ;;
    --local-persona-model-map)    LOCAL_PERSONA_MODEL_MAP="$2"; shift 2 ;;
    --help|-h)
      cat <<'HELP'
Usage: run_fresh.sh [N] [--task-source RUBRIC|CONSTRAINT_BINDING]
                    [--producer ORCHESTRATOR|SINGLE_SHOT|LADDER|ALL]
                    [--tool claude-code|copilot|codex]
                    [--budget-cap N]
                    [--extractor deterministic|local|anthropic]
                    [--session   deterministic|local|anthropic]
                    [--local-backend ... --local-base-url ... etc.]

Provider flags forward to the ORCHESTRATOR producer's swarm run
subprocess. Each flag has a matching env-var (EXTRACTOR_PROVIDER /
SESSION_PROVIDER / LOCAL_LLM_*) -- explicit flags override the env
when both are set. SINGLE_SHOT and LADDER producers do not invoke the
orchestrator and ignore these flags.
HELP
      exit 0 ;;
    --*) echo "ERROR: unknown flag: $1" >&2; exit 2 ;;
    *)   TARGET_RUNS="$1"; shift ;;
  esac
done
TARGET_RUNS="${TARGET_RUNS:-8}"

# Build the orchestrator-bound provider flag list once. Each set value
# becomes a `--flag value` pair; unset values are skipped so the default
# (no provider flags) is unchanged.
PROVIDER_FLAGS=()
[ -n "$EXTRACTOR_PROVIDER" ]            && PROVIDER_FLAGS+=("--extractor" "$EXTRACTOR_PROVIDER")
[ -n "$SESSION_PROVIDER" ]              && PROVIDER_FLAGS+=("--session" "$SESSION_PROVIDER")
[ -n "$LOCAL_LLM_BACKEND" ]             && PROVIDER_FLAGS+=("--local-backend" "$LOCAL_LLM_BACKEND")
[ -n "$LOCAL_LLM_BASE_URL" ]            && PROVIDER_FLAGS+=("--local-base-url" "$LOCAL_LLM_BASE_URL")
[ -n "$LOCAL_LLM_MODEL_EXTRACTOR" ]     && PROVIDER_FLAGS+=("--local-model-extractor" "$LOCAL_LLM_MODEL_EXTRACTOR")
[ -n "$LOCAL_LLM_MODEL_SESSION" ]       && PROVIDER_FLAGS+=("--local-model-session" "$LOCAL_LLM_MODEL_SESSION")
[ -n "$LOCAL_LLM_GRAMMAR" ]             && PROVIDER_FLAGS+=("--local-grammar" "$LOCAL_LLM_GRAMMAR")
[ -n "$LOCAL_LLM_API_KEY" ]             && PROVIDER_FLAGS+=("--local-api-key" "$LOCAL_LLM_API_KEY")
[ -n "$LOCAL_LLM_SEED" ]                && PROVIDER_FLAGS+=("--local-seed" "$LOCAL_LLM_SEED")
[ -n "$LOCAL_LLM_REQUEST_TIMEOUT_MS" ]  && PROVIDER_FLAGS+=("--local-request-timeout-ms" "$LOCAL_LLM_REQUEST_TIMEOUT_MS")
[ -n "$LOCAL_LLM_MAX_CONCURRENCY" ]     && PROVIDER_FLAGS+=("--local-max-concurrency" "$LOCAL_LLM_MAX_CONCURRENCY")
[ -n "$LOCAL_PERSONA_MODEL_MAP" ]       && PROVIDER_FLAGS+=("--local-persona-model-map" "$LOCAL_PERSONA_MODEL_MAP")

if [ "$TASK_SOURCE" = "CONSTRAINT_BINDING" ]; then
  CB_TASKS_DIR="$REPO_ROOT/benchmarks/constraint-binding/tasks"
  CB_FIXTURES_DIR="$REPO_ROOT/benchmarks/constraint-binding/fixtures"
  CB_VALIDATOR="$REPO_ROOT/benchmarks/constraint-binding/validator-engine.js"
  TASK_COUNT=$(ls -1 "$CB_TASKS_DIR"/*.yaml 2>/dev/null | wc -l)
  if [ "$TASK_COUNT" -eq 0 ]; then
    echo "ERROR: no constraint-binding task YAMLs found in $CB_TASKS_DIR" >&2
    exit 1
  fi
else
  # Prefer rubric tasks; fall back to legacy
  if [ -f "$RUBRIC_TASKS" ]; then
    TASKS_FILE="$RUBRIC_TASKS"
  else
    TASKS_FILE="$LEGACY_TASKS"
  fi
  TASK_COUNT=$(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))))")
fi

# D2: Warn on partial cycles
if [ $(( TARGET_RUNS % TASK_COUNT )) -ne 0 ]; then
  echo "WARNING: $TARGET_RUNS runs is not a multiple of $TASK_COUNT tasks — last cycle will be partial." >&2
fi

mkdir -p "$RESULTS_DIR"

if [ "$TASK_SOURCE" = "CONSTRAINT_BINDING" ]; then
  echo "Source:   CONSTRAINT_BINDING ($TASK_COUNT tasks under $CB_TASKS_DIR)"
else
  echo "Source:   $TASK_SOURCE ($TASK_COUNT tasks, $(basename "$TASKS_FILE"))"
fi
echo "Producer: $PRODUCER"
echo "Runs:     $TARGET_RUNS per producer"
echo "Budget:   $BUDGET_CAP (ladder cap)"
echo ""

# ── helpers ───────────────────────────────────────────────────
task_field() {
  # task_field <index> <field>
  python3 -c "
import json, sys
t = json.load(open('$TASKS_FILE'))[$1]
# rubric_tasks uses 'prompt'; legacy uses 'goal'
val = t.get('$2', t.get('goal' if '$2' == 'prompt' else '$2', ''))
print(val)
"
}

# ── constraint-binding helpers ────────────────────────────────
cb_task_path() {
  # cb_task_path <index> -> prints absolute YAML path
  local idx="$1"
  ls -1 "$CB_TASKS_DIR"/*.yaml | sort | awk -v i="$idx" 'NR == i+1'
}

cb_field() {
  # cb_field <task.yaml> <dotted.path> -> prints scalar value
  local yaml_path="$1" key="$2"
  node -e "
    const y = require('js-yaml');
    const fs = require('fs');
    const t = y.load(fs.readFileSync('$yaml_path','utf8'));
    const parts = '$key'.split('.');
    let v = t;
    for (const p of parts) v = v[p];
    process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
  "
}

cb_extract_fixture() {
  # cb_extract_fixture <task.yaml> <workspace>
  local yaml_path="$1" ws="$2"
  local tarball
  tarball=$(cb_field "$yaml_path" "pre_state.fixture_tarball")
  local full="$CB_FIXTURES_DIR/$tarball"
  if [ ! -f "$full" ]; then
    echo "ERROR: fixture not found: $full. Run scripts/fetch-fixtures.sh first." >&2
    return 1
  fi
  # Verify sha256 before extraction
  local expected actual
  expected=$(cb_field "$yaml_path" "pre_state.fixture_sha256")
  actual=$(sha256sum "$full" | awk '{print $1}')
  if [ "$expected" != "$actual" ] && [ "$expected" != "pending" ]; then
    echo "ERROR: fixture sha256 mismatch for $tarball" >&2
    echo "  recorded: $expected" >&2
    echo "  actual:   $actual"   >&2
    return 1
  fi
  tar -xzf "$full" -C "$ws"
}

cb_score() {
  # cb_score <task.yaml> <workspace> <run_dir>
  local yaml_path="$1" ws="$2" run_dir="$3"
  node "$CB_VALIDATOR" run "$yaml_path" "$ws" \
    > "$run_dir/validator-report.json" 2>"$run_dir/validator-report.stderr"
  local rc=$?
  # Emit a simple pass/fail score artifact mirroring the rubric runner shape
  local passed="false"
  [ "$rc" -eq 0 ] && passed="true"
  cat > "$run_dir/constraint-binding-score.json" <<SCORE
{
  "task_id": "$(cb_field "$yaml_path" id)",
  "pattern": "$(cb_field "$yaml_path" pattern)",
  "passed": $passed,
  "report_path": "validator-report.json"
}
SCORE
  return $rc
}

# ── ORCHESTRATOR ──────────────────────────────────────────────
run_orchestrator() {
  local task_id="$1" task_prompt="$2" run_dir="$3" workspace="$4"

  if [ ! -f "$SWARM_BIN" ]; then
    echo "ERROR: Build first — npm run build" >&2
    return 1
  fi

  # Run swarm inside the workspace directory. Forward provider-selection
  # flags so the producer's run honors --extractor/--session/--local-*
  # without depending on env-var inheritance into the subshell alone.
  # The `${PROVIDER_FLAGS[@]+...}` idiom safely expands to nothing under
  # bash 3.2 + `set -u` when the array is empty (default case).
  (cd "$workspace" && node "$SWARM_BIN" run \
    --goal "$task_prompt" \
    --tool "$TOOL" \
    --yes \
    ${PROVIDER_FLAGS[@]+"${PROVIDER_FLAGS[@]}"} \
    > "$run_dir/orchestrator_stdout.txt" 2>&1) || true

  # Copy metadata artifacts from the inner swarm run directory
  local latest
  latest=$(ls -dt "$workspace/runs/swarm-"* 2>/dev/null | head -1 || true)
  if [ -n "$latest" ] && [ -d "$latest" ]; then
    for f in session-state.json metrics.json cost-attribution.json; do
      [ -f "$latest/$f" ] && cp "$latest/$f" "$run_dir/"
    done
    [ -d "$latest/quality-gates" ] && cp -r "$latest/quality-gates" "$run_dir/"
  fi
}

# ── SINGLE_SHOT ───────────────────────────────────────────────
run_single_shot() {
  local task_prompt="$1" run_dir="$2" workspace="$3"

  # Run claude inside the workspace directory so generated files land there
  (cd "$workspace" && claude --dangerously-skip-permissions -p "$task_prompt" \
    > "$run_dir/baseline_stdout.txt" 2>&1) || true

  # Exactly 1 premium request by definition
  cat > "$run_dir/cost-attribution.json" <<-COST
	{
	  "totalEstimatedPremiumRequests": 1,
	  "totalActualPremiumRequests": 1,
	  "estimateAccuracy": 1.0,
	  "modelUsed": "claude-sonnet-4",
	  "modelMultiplier": 1,
	  "overageTriggered": false,
	  "perStep": [{
	    "stepNumber": 1,
	    "agentName": "baseline-single-shot",
	    "estimatedPremiumRequests": 1,
	    "actualPremiumRequests": 1,
	    "retryCount": 0,
	    "promptTokens": 0,
	    "fleetMode": false,
	    "durationMs": 0
	  }]
	}
	COST
}

# ── LADDER ────────────────────────────────────────────────────
run_ladder() {
  local task_index="$1" run_dir="$2" workspace="$3"

  # Delegate to external ladder script if present
  if [ -x "$LADDER_SCRIPT" ]; then
    bash "$LADDER_SCRIPT" "$TASKS_FILE" "$task_index" "$run_dir" "$BUDGET_CAP" "$workspace" || true
    return
  fi

  # Inline fallback: iterate ladder_prompts from task definition
  local request_count=0
  local prompts
  prompts=$(python3 -c "
import json
t = json.load(open('$TASKS_FILE'))[$task_index % $(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))))")]
for p in t.get('ladder_prompts', [t.get('prompt', t.get('goal',''))]):
    print(p)
")

  while IFS= read -r prompt; do
    [ -z "$prompt" ] && continue
    if [ "$request_count" -ge "$BUDGET_CAP" ]; then
      echo "  Budget cap ($BUDGET_CAP) reached"
      break
    fi
    request_count=$((request_count + 1))
    echo "  Ladder step $request_count: ${prompt:0:80}..."
    (cd "$workspace" && claude --dangerously-skip-permissions -p "$prompt" \
      >> "$run_dir/ladder_stdout.txt" 2>&1) || true
  done <<< "$prompts"

  cat > "$run_dir/cost-attribution.json" <<-COST
	{
	  "totalEstimatedPremiumRequests": $request_count,
	  "totalActualPremiumRequests": $request_count,
	  "estimateAccuracy": 1.0,
	  "modelUsed": "claude-sonnet-4",
	  "modelMultiplier": 1,
	  "overageTriggered": false,
	  "perStep": []
	}
	COST
}

# ── main loop ─────────────────────────────────────────────────
run_producer() {
  local pname="$1"
  local pdir="$RESULTS_DIR/$pname"
  mkdir -p "$pdir"

  local existing
  existing=$(find "$pdir" -maxdepth 1 -type d -name "run-*" 2>/dev/null | wc -l)
  local n=$((existing + 1))

  while [ "$n" -le "$TARGET_RUNS" ]; do
    local tidx
    if [ -n "${TASK_INDEX:-}" ]; then
      tidx="$TASK_INDEX"
    else
      tidx=$(( (n - 1) % TASK_COUNT ))
    fi
    local task_id task_prompt task_name task_yaml=""
    if [ "$TASK_SOURCE" = "CONSTRAINT_BINDING" ]; then
      task_yaml="$(cb_task_path "$tidx")"
      task_id=$(cb_field "$task_yaml" id)
      task_prompt=$(cb_field "$task_yaml" prompt)
      task_name=$(cb_field "$task_yaml" name)
    else
      task_id=$(task_field "$tidx" "id")
      task_prompt=$(task_field "$tidx" "prompt")
      task_name=$(task_field "$tidx" "name")
    fi
    [ -z "$task_name" ] && task_name="$task_id"

    local ts
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    local rdir="$pdir/run-${ts}-${task_id}"
    mkdir -p "$rdir"

    # Create isolated workspace for code artifacts
    local workspace="$rdir/workspace"
    mkdir -p "$workspace"

    echo "════════════════════════════════════════════════════"
    echo "  [$pname] Run $n/$TARGET_RUNS — $task_id"
    echo "  $rdir"
    echo "  workspace: $workspace"
    echo "════════════════════════════════════════════════════"

    # Extract the constraint-binding fixture into the workspace before the
    # producer sees it. This is what lets the producer operate on a real OSS
    # snapshot instead of an empty dir.
    if [ "$TASK_SOURCE" = "CONSTRAINT_BINDING" ]; then
      cb_extract_fixture "$task_yaml" "$workspace" || {
        echo "  fixture extraction failed; skipping run" >&2
        n=$((n + 1))
        continue
      }
    fi

    local t0
    t0=$(date +%s)

    case "$pname" in
      ORCHESTRATOR) run_orchestrator "$task_id" "$task_prompt" "$rdir" "$workspace" ;;
      SINGLE_SHOT)  run_single_shot "$task_prompt" "$rdir" "$workspace" ;;
      LADDER)       run_ladder "$tidx" "$rdir" "$workspace" ;;
    esac

    local t1 elapsed
    t1=$(date +%s)
    elapsed=$(( t1 - t0 ))

    # Write metadata FIRST (score.sh uses run-meta.json for elapsed fallback)
    cat > "$rdir/run-meta.json" <<-META
	{
	  "task_id": "$task_id",
	  "task_name": "$task_name",
	  "producer": "$pname",
	  "tool": "$TOOL",
	  "timestamp": "$ts",
	  "elapsed_seconds": $elapsed,
	  "budget_cap": $BUDGET_CAP,
	  "task_index": $tidx
	}
	META

    # Score (metadata-based metrics)
    bash "$SCORE_SCRIPT" "$rdir" 2>/dev/null || true

    if [ "$TASK_SOURCE" = "CONSTRAINT_BINDING" ]; then
      cb_score "$task_yaml" "$workspace" "$rdir" || true
    else
      # Rubric score (code-artifact completeness)
      if [ -f "$RUBRIC_RUNNER" ]; then
        python3 "$RUBRIC_RUNNER" "$workspace" "$TASKS_FILE" "$tidx" \
          > /dev/null 2>&1 || true
        [ -f "$workspace/rubric-score.json" ] && cp "$workspace/rubric-score.json" "$rdir/"
      fi
    fi

    echo "  Done in ${elapsed}s"
    echo ""
    n=$(( n + 1 ))
  done
}

# ── dispatch ──────────────────────────────────────────────────
case "$PRODUCER" in
  ORCHESTRATOR) run_producer "ORCHESTRATOR" ;;
  SINGLE_SHOT)  run_producer "SINGLE_SHOT"  ;;
  LADDER)       run_producer "LADDER"       ;;
  ALL)
    run_producer "ORCHESTRATOR"
    run_producer "SINGLE_SHOT"
    run_producer "LADDER"
    ;;
  *)
    echo "ERROR: Unknown producer '$PRODUCER'. Use ORCHESTRATOR | SINGLE_SHOT | LADDER | ALL." >&2
    exit 1
    ;;
esac

echo "════════════════════════════════════════════════════"
echo "  All $PRODUCER runs complete."
echo "════════════════════════════════════════════════════"
echo ""
echo "Next:"
echo "  python3 benchmarks/harness/scoring/compute_ci.py  $RESULTS_DIR"
echo "  python3 benchmarks/harness/scoring/sampler_audit.py $RESULTS_DIR"
