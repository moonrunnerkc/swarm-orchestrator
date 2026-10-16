# Comparison of 2026-10-15: registered before any scored launch

A small, valid comparison of Swarm Orchestrator against OpenCode on four fresh real tasks under
one common local configuration, run only after both tools had each delivered one real,
independently checked repository change under that configuration (the calibration). It is
separate from the 2026-10-14 pilot ([../../2026-10-14/real-task-pilot/protocol.md](../../2026-10-14/real-task-pilot/protocol.md))
and from the live diagnosis ([../bugfix-diagnosis/protocol.md](../bugfix-diagnosis/protocol.md));
it pools with neither, and the old csstree bug fix stays an unresolved limitation of its own.
Everything below is frozen before the first scored launch; the stage A manifest carries this
file's digest, the product build's tree digest, the installed OpenCode version, the served model
and the harness digest.

## Readiness, established before the freeze

- Integration canaries: each tool, through its ordinary entry point, connected to the endpoint,
  received the pinned model, called its real tools, read a repository file, made the requested
  edit, ran the project's check and reported the result, on the disposable smoke task; the
  request bodies each tool actually sent were captured by a proxy and read back. At most four
  canary executions of two minutes; their cost is reported apart from every task result.
- The retained csstree bug fix under OpenCode, under each earlier tested configuration that can
  be made valid (rapid-mlx with `qwen3.8:27b`; Ollama with `qwen3.6:35b-a3b` and thinking off
  through `reasoning_effort`), as development diagnosis beside the retained Swarm attempts.
- Calibration: one declared non-trivial task (`argparse-calibration-number-conversion`) under
  both tools; each must deliver it correctly by the hidden oracle before the comparison is
  frozen. A canary, a replayed patch or a supplied solution does not count. The calibration task
  and every solution exposed in development are excluded from scoring.
- The common configuration is chosen by compatibility and by both calibrations succeeding, not
  by Swarm's relative advantage. Development launches (diagnosis and calibration) are capped at
  six of fifteen minutes.

## Instrument

The proved comparison runner (`scripts/comparison/run.mjs --manifest <file>`) with the stop
controls of PR #81 and the repairs since, unchanged during the campaign: the harness digest is
in the manifest and a launch under an edited harness is refused. What changed on this branch
before the freeze, each with its regression: one token allowance per launch shared by the
initial invocation and every scripted correction; each arm's spend recorded by kind (input,
output, reasoning, cached) as the arm reports it; OpenCode's model options carrying every
spelling of "thinking off" the local servers read; task-authored hidden acceptance checks
written into the scoring checkout only.

- Swarm: built in isolation from the tested commit into `~/.cache/swarm-comparison/tools/swarm-<commit>`;
  the manifest pins the CLI path, its bytes and a digest over the whole built tree.
- OpenCode: the installed version, pinned by `opencode --version`, with the workspace
  configuration the harness writes (`scripts/comparison/workspace.mjs`): the same endpoint,
  model, output cap (8192), thinking off and sampling as Swarm's provider sends.
- Model and server: named in the manifest after calibration, one model resident at a time, one
  request stream at a time on this host, no other inference workload during launches. The
  request settings each tool sends are the proxy capture from the canaries, not a guess.
- Permissions: Swarm runs under its lexical path and program policy with `--approve auto`, a
  sealed goal contract outside the solver's reach, a private child HOME per run; OpenCode runs
  with edit and shell allowed in the workspace, no web fetch, HOME set to the launch's own
  directory. Neither is sandboxed. Claims about security or efficiency of the tools' own
  execution are out of scope; task-level security results are in.

## Tasks

Four tasks across three public repositories, each a historical maintainer-authored change, none
used by any earlier launch, calibration, diagnosis or repair here (the pako repository appears
with two changes; csstree's one task is a change untouched by its earlier task). Selection criteria and the excluded
candidates: [candidates.md](candidates.md). Definitions, visible checks, hidden oracles and the
deliberately wrong implementations: `scripts/pilot/tasks-2026-10-15.mjs`.

| task | type | repository | security-relevant behaviour |
| --- | --- | --- | --- |
| mime-bugfix-gettype-line-terminators | bug fix | broofa/mime | a content type decided from an untrusted file name must come from the extension after the last dot whatever line terminator precedes it; the negative control strips only the two ASCII terminators and the hidden cases for U+2028 and U+2029 reject it |
| pako-feature-inflate-push-after-end | feature | nodeca/pako | none claimed; robustness of a decoder against trailing bytes, judged by the hidden tests |
| pako-refactor-options-default-param | refactor | nodeca/pako | none claimed |
| csstree-upgrade-esbuild-0-24 | upgrade | csstree/csstree | none claimed beyond the dependency change itself |

For every task, before either arm runs and with no model: full base and reference ids pinned;
the base installs from its lockfile and its own tests run; the base with the visible check
committed fails the visible check and the hidden oracle executed over it; the reference passes
both (for the upgrade, the maintainer's change with its range declaration rewritten to the
exact version the task requires, as the pilot's amendment did); the visible check does not
fail the project's lint where lint passes without it; the deliberately wrong or partial
implementation is rejected by the hidden oracle. Output: [validation.json](validation.json).
Hidden material (the upstream test files, the task-authored hidden checks) lives only in the
sealed mirror and the task module; each arm works in a shallow clone of the base with the
remote removed, and every Swarm evidence directory is scanned afterwards for the sealed commit
id and the mirror path.

Each task's requirement matrix is its task text: mandatory requirements are the stated
behaviour, the structural or version requirements, the file scope and the project's own suite;
discretionary preferences are readability and proportion, judged by the review rubric below.
Both arms receive identical task text, the same visible check in the tree, the same install and
test commands and the same workspace. Swarm seals the visible check as its contract, as the
product does.

Stage B is fixed now as the bug fix and the feature of stage A, repeated unchanged under the
ids with suffix `-rep` in a second manifest. Launch order within a stage is the comparison's
frozen order (seeded hash, first arm alternating by position).

## Budgets

| budget | value |
| --- | --- |
| scored launches | stage A 8 (4 tasks, 2 arms); stage B 4; reruns after a relevant repair at most 4, each replacing a cell both arms rerun under the same revised conditions, never a loss |
| per launch | one deadline of 15 minutes covering the initial invocation, up to two scripted corrections and internal verification; a correction starts with at least one minute; 60 s of termination grace is cleanup, tracked separately |
| scripted corrections | at most two per launch, each a re-invocation with the visible failure output only |
| Swarm token allowance | 8,000,000 per launch, shared by every invocation of the launch; a bound checked between calls, not a hard cap, which the record states. Set above anything either arm spent in a fifteen-minute launch observed here (5.9 million at most), so the wall is the bound both arms share. OpenCode has no native cap and runs to the wall only: the arms are not budget-matched on tokens, and no claim treats the limits as equal. Amended before the freeze from the pilot's 600,000, which the first calibration attempt showed binding in two minutes on the Ollama configuration (26 calls, prompt-bound) while the other arm ran on uncapped ([readiness/calibration-ollama/](readiness/calibration-ollama/)) |
| agent minutes, whole comparison | at most 240 (16 launches of 15); 12 intended |
| development (diagnosis and calibration) | at most 6 launches of 15 minutes, 90 agent-minutes, reported apart |
| canaries | at most 4 of 2 minutes, reported apart |

No manual repair, no hints, no replacement launches. A halt (bad setup, gate drift, endpoint
failure, invalid scoring, corrupted evidence, unconfirmed owned process) stops dispatch; the
cause is repaired and verified deterministically, and the campaign resumes only through
`--recover --justification`. After a repair that changes the product, provider, scoring or
acceptance, the affected cells are re-frozen and rerun for both arms; earlier attempts are kept
with development or invalid status and their reasons, never pooled.

## Scoring, per launch

As the pilot defined them, derived by `scripts/pilot/analyze.mjs` from the published evidence
alone: correct patch (hidden oracle on the exact final patch in a fresh checkout); correctly
delivered (correct patch, visible checks resolved, exit 0 within budget, a completion claim
without contradiction, for Swarm its own acceptable verdict with evidence present and no oracle
exposure, for OpenCode a final answer that reads as completion under the keyword heuristic);
delivered without scripted correction; false claim; corrections, internal repair and stops; time
(agent wall, preparation, scoring, end-to-end); tokens by kind as each arm reports them, with
unknown usage named. Cost per correct delivery is all attributable launch cost over correct
deliveries; zero deliveries makes it undefined.

Added for this comparison, judged over the final patch of every launch after the live work:

- Security and coding quality: the task-specific security result where one is declared; lint
  and type compliance by the project's own commands where they pass at the base; the file scope
  and dependency changes against the task's closed set; whether existing tests and
  instructions were preserved. Each is executable except the review rubric.
- Review rubric, anchored: readable and proportional design (1 to 3), scope discipline (1 to 3),
  comment and documentation accuracy (1 to 3), applied by the reporting assistant over patches
  labelled by a random letter with the arm hidden; the method and its uncertainty are disclosed
  in the results and the rubric scores are discretionary, never mandatory requirements.
- Reproducibility: the retained final patches re-scored by the oracle from the published
  evidence; the derived tables re-rendered by the analyzer; stage B's repeated launches
  reported as patch variation (equivalent correct solutions are not required to match byte for
  byte, and deterministic verification is not deterministic generation). Seeds are not sent:
  neither server honours one for these models.

Both tools' actual final reports are recorded and judged by the same truth standard; Swarm's
structured-evidence promises (verdict, bundle, final verification) are verified separately
against its ledgers.

## Spending rule, frozen

Stage B runs only if all of these hold after stage A:

1. all eight stage A records are valid and inspectable, with no unresolved setup, scoring or
   exposure problem;
2. Swarm correctly delivers at least three of four, including the bug fix and the feature,
   without manual help or a false completion claim, each claimed delivery meeting every
   mandatory requirement including the applicable security and coding rules;
3. a concrete quality or supervision advantage: more correct deliveries without correction; or
   fewer corrections at equal delivery performance; or a predeclared, independently checked
   improvement in completeness, security or engineering quality at equal delivery performance.
   Speed alone does not pass;
4. Swarm is no worse on the other declared primary quality, supervision and reliability
   measures (false claims, deliveries, corrections, launches killed at the wall, unresolved
   tasks). Primary cost measures, declared now: end-to-end minutes per correct delivery and
   tokens per correct delivery as each arm reports them. A material cost regression or an
   unresolved primary measurement prevents an unqualified overall recommendation, whatever one
   quality dimension shows.

PROCEED TO A LARGER STUDY additionally requires both repeated Swarm tasks delivered correctly
and the advantage still supported in the combined descriptive results, every repetition
reported with its variation and no failed delivery averaged away. PROCEED is permission to
recommend a larger study, not to launch one; the long study stays paused until the results are
reviewed. An advantage on selected dimensions is described on those dimensions; "across the
board" requires improvement on every metric in the claim, and ties are ties. Four unique tasks
cannot prove general superiority or comprehensive security, and a functioning baseline's real
task failure stays in the results.

## What is frozen after this point

Swarm's build, OpenCode's version, the model and its server settings, the tasks, the visible
checks, the hidden oracles, the budgets, the supervision rule, the scoring and the decision
rule. A product defect found after the freeze halts the campaign; it is repaired with a
regression, the affected cells are re-frozen under a new manifest and rerun for both arms, and
the halted attempts are kept as development records.
