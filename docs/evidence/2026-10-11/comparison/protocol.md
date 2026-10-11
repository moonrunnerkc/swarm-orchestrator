# Exploratory comparison: Swarm Orchestrator against an ordinary coding agent, registered 2026-10-11

An exploratory, small, separate trial of the product hypothesis: that Swarm reaches the same
specified outcome more reliably, with fewer external corrections and lower elapsed time or token
cost than an ordinary agent. It is separate from the registered campaign of 2026-09-29
([protocol](../../../verifier-first/campaign-protocol-2026-09-29.md)): different repositories,
different tasks, different arms and a different scoring rule. It does not run that campaign,
does not complete it, and its results are not pooled with it. Everything below the amendment
line changes only by dated amendment.

## Tasks

Five public repositories, independently maintained, with a committed npm lockfile and tests that
run offline on Node 24 after a locked install, appearing nowhere in this repository's campaign
corpus, pull-request pools, study frames or earlier evidence (checked by
`grep -rIlF <owner/name> campaign docs scripts src` printing nothing before selection):
markedjs/marked, NaturalIntelligence/fast-xml-parser, yargs/yargs-parser, nodeca/js-yaml and
isaacs/minimatch. Twenty repositories were screened; the others were excluded for an earlier
appearance (eemeli/yaml, uuidjs/uuid, motdotla/dotenv, chalk/chalk, ajv-validator/ajv,
websockets/ws, expressjs/express) or for having no committed lockfile.

Every task is a historical upstream change: the base is the parent of the upstream commit, the
task text was written from the change without naming it, and the upstream commit is sealed from
both arms (they work on a shallow clone of the base taken through a tag from a local mirror, with
the remote removed). Tasks were mined by reading each repository's history for one change per
work type (bugfix, feature, refactor, dependency upgrade) with 5 to 60 source lines, whose tests
fail on the parent and pass on the commit (bugfix, feature), pass on both with a mechanically
checkable structural property that only the commit has (refactor), or bump named dependencies
to exact versions with the lockfile regenerated (upgrade). yargs/yargs-parser had no feature or
refactor change meeting the bound in the window, so it contributes two bugfixes and an upgrade.
The task definitions, including the visible check each arm is shown, are
[scripts/comparison/tasks.mjs](../../../../scripts/comparison/tasks.mjs); the mined candidates
with their verification logs are retained beside the session's working files.

**Visible check.** One short `acceptance/visible/check.mjs` per task, committed on top of the
base as the project would keep an acceptance test, asserting one representative behavior the
task text names. It is deliberately weaker than the hidden oracle. Both arms are told the exact
command that runs it and the project's own test command, and that the directory may not be
edited.

**Hidden oracle.** The upstream commit's own test files for the change (overlaid from the sealed
mirror into a fresh checkout at scoring time), run with the specific test argv; for a refactor
also the structural checks (exact grep counts); for an upgrade also the lockfile's resolved
version and the installed package version; and in every case the project's own test command.
Maintainer-written tests are the independent acceptance evidence here; where the mining agent
suggested extra edge cases they were not added, so the oracle's completeness is the upstream
suite's. The oracle is read from the mirror at scoring time only; after every Swarm run its
evidence directory is searched for the sealed commit id and the mirror path, and a hit is
recorded as an exposure and excluded from any superiority reading.

**Deterministic validation**, before any arm runs and with no model
([validate.mjs](../../../../scripts/comparison/validate.mjs)): the base with the visible check
committed must fail the visible check and the hidden oracle; the upstream reference (the upstream
diff, tests included) must pass both. A task that fails validation is dropped before freeze with
the reason recorded in [validation.json](validation.json).

## Arms

Both arms get the same workspace (a shallow clone of the base with the visible check committed,
prepared with the task's own install argv, lifecycle scripts off), the same task text, the same
visible check in the tree, the same model (`qwen3.8:27b`, MLX 8-bit, served by rapid-mlx at
`http://127.0.0.1:8000/v1`, thinking off), the same wall budget and the same supervision rule.

- **swarm**: this repository's agent, built from the pinned revision, invoked as
  `swarm "<task text + visible check + test command>" --goal-contract <contract> --install
  --max-tokens 600000 --max-wall-minutes <remaining> --approve auto --no-tui --no-open-evidence
  --json`, plus `--preset upgrade` for an upgrade task, as the product requires. The contract
  seals the visible check as one shared, user-authored command check with the acceptance
  directory and the repository's test directory immutable. The agent's own acceptance gate,
  bounded repair and final independent verification are internal to the arm.
- **opencode**: OpenCode 1.14.48, `opencode run --pure --format json -m rapidmlx/qwen3.8:27b
  "<the same text>"`, with a workspace `opencode.json` (excluded from the change) that names the
  provider and grants edit and shell permission, so the run is unattended with its ordinary
  testing and repair behavior. It carries no token cap flag; its usage is read from its own
  events.

Noncomparable configurations, reported rather than corrected: Swarm has a contract outside the
workspace and an upgrade authorization policy; OpenCode has neither. Swarm's token cap is a
budget it enforces; OpenCode's is the wall clock only. Both ran on this host in the product's
default modes, not in a container.

## Supervision protocol

Applied identically to both arms by the launcher, before any run was read:

1. The arm runs its normal autonomous workflow on the task prompt within 30 minutes of wall clock
   for the whole launch (every invocation and its corrections).
2. After each invocation the supervisor measures the **visible verdict** in a fresh checkout of
   the base with the visible check committed and the arm's change applied: the visible check
   command and the project's own tests. The supervisor reads only these and the arm's exit, never
   the hidden oracle.
3. If the visible verdict fails, the supervisor re-invokes the same arm in the same workspace
   with the task prompt and the failing output appended, at most twice. Each re-invocation is one
   **scripted external correction**. Nothing else is corrected: no manual edits, no environment
   repair, no restart.
4. The final tree after the protocol is scored by the hidden oracle whether or not the visible
   verdict was ever reached.

Internal planning, testing, repair and verification an arm does on its own are time and tokens,
never interventions. A scripted correction is a proxy for supervision, never an observation of a
person. A run that fails without a correction is an unsuccessful zero-correction run.

## Measures, each reported on its own, with denominators

- correct completion (hidden oracle passed) out of all launches started;
- correct completion with zero scripted corrections;
- scripted corrections used, total and by count, and launches whose visible verdict was never
  reached;
- launches where the arm's own account claimed success while the hidden oracle failed (Swarm: an
  acceptable verdict with exit 0; OpenCode: exit 0 with no error event, the only account it
  gives);
- agent wall time over all launches and over correct launches; preparation time separately;
- tokens over launches with known usage and per correct task; unknown usage stays unknown and is
  never estimated. No monetary cost: every model call is local.
- infrastructure failures, retained and shown, never counted as an arm's result.

Three repetitions were not run: one launch per task and arm. The trial is paired by task and
exploratory; no significance claim is made from it.

## Order, pins, reruns

Tasks in the order of `sha256("swarm-ordinary-comparison-2026-10-11:" + id)`, both arms of a
task back to back with the first arm alternating by position. A launch runs once; a launch that
failed for infrastructure (preparation did not complete, the endpoint did not answer) is rerun
at most once with the failed record kept beside it. No result is read before deciding a rerun.
Records are written once under `~/.cache/swarm-comparison/runs/<manifest digest>/` and never
overwritten; the manifest ([manifest.json](manifest.json)) pins the task set with full commit
ids, the Swarm revision, the OpenCode version, the model, the endpoint, the budgets and the
order, and carries this document's digest.

## What this trial can support

More tasks correct without scripted corrections supports greater autonomy on these tasks; fewer
scripted corrections to reach the visible verdict supports lower supervision demand under this
protocol; better hidden-oracle outcomes at lower time or tokens supports greater task efficiency
under these conditions. Together they can support a clearly labelled inference of less expected
human rework. Developer hours saved, universal superiority, retention and correctness beyond
the upstream tests remain unestablished.

---

Amendments are appended below with date and reason.
