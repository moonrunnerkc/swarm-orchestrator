# Constraint-Binding Task Schema

Every file under `benchmarks/constraint-binding/tasks/*.yaml` conforms to this
schema. The schema is enforced by `validator-engine.js` and by the unit tests
in `test/constraint-binding/task-schema.test.ts`.

## Required fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | kebab-case, unique across the suite, matches filename stem |
| `name` | string | human-readable short title |
| `pattern` | enum | one of `schema-then-query`, `rename-then-update-callers`, `contract-change-then-client`, `lift-then-reuse` |
| `pre_state.fixture_tarball` | string | path relative to `benchmarks/constraint-binding/fixtures/`, produced by `scripts/fetch-fixtures.sh` |
| `pre_state.source_repo` | string | upstream git URL the fixture is derived from |
| `pre_state.source_sha` | string | full 40-char commit SHA, pinned |
| `pre_state.fixture_sha256` | string | SHA-256 of the produced tarball (lowercase hex) |
| `prompt` | string | the goal text passed to every producer |
| `expected_steps_min` | number | minimum plan-step count for the orchestrator (sanity check) |
| `post_state_validators` | array | see below |

## `post_state_validators`

Each entry is an object with:

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | short label surfaced in the scoreboard |
| `cmd` | string | bash command, exit 0 = pass, non-zero = fail |

Validators run **in the order listed**, in the fixture's extracted workspace
directory, after the producer completes. The task fails on the first non-zero
exit. A passing task requires every validator to pass.

Validators **must** exercise real correctness. Grep-presence checks alone are
rejected by review: a validator that passes under a broken implementation is
worse than no validator. When in doubt, chain a grep with a behavioural test:

```yaml
- name: "new name used"
  cmd: "test $(grep -rc 'findUserByIdentifier' src/ test/ | awk -F: '{s+=$2}END{print s}') -ge 8"
- name: "behavioural preservation"
  cmd: "npm test"
```

## Fair-test invariant: byte-identical prompts

The `prompt` field is passed **verbatim** to every producer (ORCHESTRATOR,
SINGLE_SHOT, LADDER, and any comparator). Producers may decompose the prompt
internally — the orchestrator is expected to — but the string each producer
receives from the harness must match the YAML byte-for-byte.

This is a hard constraint, not a convention. The unit test
`test/constraint-binding/prompt-invariant.test.ts` walks every task YAML and
every producer invocation path in `run_fresh.sh`, and asserts the prompt
crosses the boundary untouched. If you add a task or a producer, that test
tells you the moment the invariant drifts.

## Example

```yaml
id: rename-then-update-callers-001
name: "Rename function and update all call sites"
pattern: rename-then-update-callers
pre_state:
  fixture_tarball: rename-then-update-callers-001.tar.gz
  source_repo: https://github.com/example/some-real-repo
  source_sha: abc123def4567890abc123def4567890abc123de
  fixture_sha256: 0000000000000000000000000000000000000000000000000000000000000000
prompt: |
  Rename the function `getUserById` to `findUserByIdentifier` throughout
  the codebase. Update all call sites. Update tests. Do not change behavior.
expected_steps_min: 3
post_state_validators:
  - name: "function renamed at definition site"
    cmd: "! grep -r 'function getUserById' src/"
  - name: "no orphaned call sites"
    cmd: "! grep -rn 'getUserById(' src/ test/"
  - name: "tests still pass"
    cmd: "npm test"
```
