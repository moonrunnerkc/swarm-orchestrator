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

### Amendment 1, 2026-10-12: two failed passes, eight defects, one relaunch of every launch

Two complete passes over the forty launches ran before this amendment, and neither stands as
the trial's result.

- **Pass 1 (2026-10-11 20:27Z to 22:13Z)**: every launch recorded an infrastructure failure. The
  harness scored each final tree against a checkout at the acceptance commit instead of the
  task's base ("checkout is not at the base"), and the OpenCode arm exited within a second with
  no output, because its runtime read the launcher's inherited `PWD` and found no workspace
  configuration there, and because the machine's global OpenCode configuration named a small
  model on another server. All three were harness defects, fixed in the launcher before pass 2.
- **Pass 2 (2026-10-12 00:01Z to 08:57Z)**: all forty launches completed and were scored. Reading
  the Swarm arm's records afterwards showed that eleven of its twenty launches had been refused
  by Swarm's own preflight before any model call, and that four more had ended for reasons that
  were defects in Swarm or in this harness rather than outcomes of the agent. The OpenCode arm's
  records show no such defect. Pass 2's counts are reported in the README as a failed pass, not
  as the comparison.

The defects, each fixed at its root in the Swarm source before pass 3 and each named in the
project's changelog:

1. Restoring the verifier checkout between goal checks rewrote every installed file, so the
   base control was refused as altered (four js-yaml launches, one minimatch launch).
2. The `npm` package installed by `@semantic-release/npm` links `npm` and `npx` under
   `node_modules/.bin`, which the instrument rule read as a shadowing interpreter (three marked
   launches).
3. A tree holding both a `package-lock.json` and a `yarn.lock` was refused with no way to name
   one (four fast-xml-parser launches).
4. An upgrade's own manifest change was read as an edit to the instrument, so no upgrade task
   could establish its regression dimension (marked cheerio upgrade).
5. The deadline cancelled the final verification mid-command, ending a run with no result line
   (js-yaml vite upgrade, whose final tree the hidden oracle nonetheless passed).
6. A tool call the model cut off at its output limit was replayed to the server as a string, and
   the server's chat template then failed on every later request; three runs ended as model
   errors (fast-xml-parser strnum upgrade, marked cheerio upgrade, one minimatch correction).
7. An immutable directory was matched by exact name in the final verification, so a formatter's
   rewrite of the visible check file was not refused (minimatch drive-letter task).
8. The upgrade preset's schema refused dotfile source paths, so the yargs-parser toolchain
   contract could not be sealed and all three of its invocations exited at once.

Two defects were in this harness and are fixed here: the js-yaml visible check files failed
that repository's own linter (semicolons and double quotes), which is a failure every candidate
would inherit, so the five js-yaml checks are restyled with the same assertions and validation
now runs each project's lint script over the base with the check committed; and the Swarm arm's
invocation now names the lockfile the harness itself installed from (`--lockfile
package-lock.json`), which is the same information the OpenCode arm receives through its
prepared `node_modules`. The task set, the task texts, the hidden oracles, the supervision
rule, the budgets, the seed and the order are unchanged.

On the rerun rule: the decision to run pass 3 was taken after reading pass 2's records, which
the rule above forbids for selective reruns. Pass 3 is not selective. Every one of the forty
launches, both arms alike, runs again under a new manifest that pins the fixed Swarm revision
and this document's new digest; pass 2's records stay under their own manifest digest with
their file digests listed in the README. The comparison is pass 3 alone.

### Amendment 2, 2026-10-13: the model server died under the OpenCode arm; one relaunch of every launch

Pass 3 (2026-10-12 09:54Z to 23:19Z) completed all forty launches under the manifest
amendment 1 froze. Reading its records afterwards showed that the OpenCode arm had not been
measured either: 44 of its 58 invocations, in every one of its twenty launches, end on
OpenCode's "Unable to connect" error within about two minutes of starting, and its final patch
is empty in all twenty. Pass 2's OpenCode launches carried the same failure (41 of 53
invocations, 16 of 20 launches), which amendment 1 did not see; its statement that the OpenCode
arm's records showed no defect was wrong. The Swarm arm lost the endpoint in none of its
invocations in either pass.

The cause, from the server's own log. OpenCode names each session with a second model call on
the same endpoint, issued while the first turn of the session is still being prefilled, so the
server batches two sequences at once; with this model's 23,000-token first turn that took the
Metal working set to about 54 GB on a 69 GB machine and the server process died of GPU memory
exhaustion (`[METAL] Command buffer execution failed: Insufficient Memory`). The launch agent
restarted it within seconds, so the harness's pre-launch probe always found it answering, and
the arm's in-flight request failed as a refused connection. Swarm sends one request at a time
and never put two sequences on the server. A controlled replay against the same server, with a
fresh 22,500-token prompt so the prefix cache missed as it did before every crash: with a
concurrent second request, the server died in 2 of 6 trials (both at an 8192-token output cap;
0 of 3 at 32000); alone, in 0 of 11 trials at either cap. OpenCode's default 32000-token output
cap for an unlisted model also exceeded what the server serves in one call: the 13 requests
that ended in `[metal::malloc] Resource limit exceeded` during a long generation were all at
that cap.

What changes, all in this harness, none in Swarm:

1. **The OpenCode arm is launched with `--title`**, so it makes no session-naming call. The
   task turn is the only request in flight. OpenCode is otherwise unchanged.
2. **The OpenCode arm's model entry declares the same per-call output cap Swarm uses (8192
   tokens)**, so both arms ask the server for the same budget per call. This is a settings line
   in the workspace's `opencode.json`, not a change to OpenCode.
3. **The endpoint is watched across every invocation.** The launcher records the process
   answering the endpoint before a launch and probes it again after each invocation; a launch
   during which that process changed or stopped answering is recorded as an infrastructure
   failure with the invocation kept, never as the arm's result, and the rerun rule applies.
4. **An OpenCode run claims success only when its last turn answered.** A run that exited 0
   with no error reported, whose last turn finished after about 10,500 generated tokens with no
   message and no tool call (the server having stopped the generation at its resource limit),
   was counted as a claim; three of the five runs in pass 3's "reported success while the
   hidden oracle failed" row for OpenCode are such runs. They were not claims.
5. **The manifest pins the harness.** A digest over the launcher's own modules is frozen with
   the manifest, and a launch under an edited harness is refused instead of recorded.

The task set, the task texts, the hidden oracles, the supervision rule, the wall budget, the
seed, the order and the Swarm revision are unchanged. As with pass 3, the decision follows a
reading of records and is not selective: every one of the forty launches, both arms alike, runs
again under a new manifest carrying this document's digest, and pass 3's records stay under
their own manifest digest with their file digests listed in the README. The comparison is
pass 4 alone.

### Amendment 3, 2026-10-13: the OpenCode arm's model was thinking; pass 4 stopped after two launches

Pass 4 began 2026-10-12 23:54Z under the manifest amendment 2 froze. Its first OpenCode launch
held the endpoint through all three invocations, which amendment 2's changes were for, and still
produced no change: in each invocation the third turn generated the whole 8192-token output cap
with no message and no tool call. The same shape, cut off by the server after about 10,500
tokens, is what pass 3's long silent turns were (10 of 92 OpenCode turns) and pass 2's (5 of
105). It is thinking. The server enables thinking for any model whose name does not contain
"coder" unless a request turns it off; Swarm turns it off in every request (`enable_thinking`
false, as the protocol's "thinking off" states), OpenCode sent nothing, and with thinking on
this model thinks to the cap and answers nothing, which is the known behaviour of this server
and model that decided the protocol's setting. The two arms were therefore not on the same
model setting in any pass, and pass 4 was stopped after its second launch rather than run for
nine hours. OpenCode also sent `top_p` 1 where Swarm sends no sampling fields and takes the
server's default of 0.95.

What changes, in the harness only: the OpenCode arm's model entry now carries
`enable_thinking: false` and `top_p: 0.95`, which OpenCode merges into every request body as
given; a run through a logging proxy shows each request leaving with `enable_thinking` false,
`top_p` 0.95 and `max_tokens` 8192, one request at a time, and the turn answering. The task
set, the task texts, the hidden oracles, the supervision rule, the wall budget, the seed, the
order and the Swarm revision are unchanged. Every one of the forty launches, both arms alike,
runs again under a new manifest carrying this document's digest; pass 4's two records stay
under their own manifest digest with their file digests in the README. The comparison is
pass 5 alone.
