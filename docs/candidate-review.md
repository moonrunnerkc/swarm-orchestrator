# Preservation obligations and the candidate review

Two parts. The first applies to every run. The second is experimental and off by default.

## Preservation obligations (every run)

Before the first model call, a run records what it must preserve
(`preservation-obligations-v1`). Each obligation is tied to its source:

| Source | Authority | What it is | What settles it |
| --- | --- | --- | --- |
| the task | authoritative | the task's own sentences about behaviour to keep ("behaves as today", "exports exactly what it exported before", "must keep passing", ...) | a review probe that quotes the sentence; otherwise **unmeasured**, since the task's word is not a measurement |
| the supplied contract | authoritative | each requirement a person supplied in `--goal-contract` | its checks' decided status |
| the base | observed | the project's own checks that pass on the base still pass | the final verification's regression reading, which already leaves out failures the base had |
| the review | proposed | probes a reviewer chose once a candidate existed (experimental, below) | the probe's own case readings |

The run reports one line, `preservation: N kept, M regressed, K unmeasured, of T obligation(s)`,
and the JSON result carries every obligation with its status and what decided it. Two rules hold:

- An obligation nothing measured is `unmeasured`, never kept.
- A run in which nothing was measured says `preservation: nothing measured`, never that it
  preserved anything.

What the base does is what currently happens, not by itself what should happen. The base
obligation is therefore the suite's, and a behaviour the task authorizes changing is not held to
the base. The set examined is finite, so a run that keeps every obligation has not shown backward
compatibility in general.

The planner and the reviewer can add obligations. They cannot remove one: those come from the
task's text, the sealed contract and the harness.

## Candidate review (experimental: `--review executable|prose`)

Once the gates are green and nothing else is owed, a separate conversation that did not write
the change reviews the actual candidate (`candidate-review-v1`). It needs `--goal-contract` or
`--plan-checks`, because its probes run on fresh checkouts the way the sealed checks do.

**What the reviewer is shown:**

- the task;
- the candidate's diff;
- the run's preservation obligations with their sources;
- what the run's checks reported.

It may read, list and search the workspace. It cannot edit or run commands, and it is never given
the implementer's account. It never sees a hidden evaluator, a reference patch or a scored
verdict.

**What it answers** (executable mode): up to four probes. Each is a program that calls the
project, with up to six inputs.

- A **preservation** probe chooses inputs whose behaviour the task does not change. The harness
  takes the expected answer from the unchanged base, as observed, so no model writes it.
- A **requirement** probe quotes the task's own words, which the harness checks against the task
  text, and gives the expected answer those words imply. It stays the reviewer's reading of the
  task.

**What the harness does with them:**

1. Each probe contract is declared on the chain, beside the root contract it derives from (lineage
   `review-probe`).
2. Every probe runs twice on a fresh checkout of the base and twice on one of the candidate,
   through the planned-check runner, with the project's own checks skipped.
3. Each case is classified from what ran:

| Reading | Meaning |
| --- | --- |
| `kept` / `met` | the candidate answers as the base does, or gives the expected answer |
| `preservation-regression` | the candidate differs from the base's observed answer (or from an expectation the base also meets) |
| `missed-requirement` | neither tree gives the answer the reviewer read in the task |
| `unstable` | two runs on one tree answered differently, so nothing is established |
| `defective-program` | the probe's own code threw |
| `did-not-load` / `did-not-complete` | the probe never answered |

Only `preservation-regression` and `missed-requirement` are established findings.

**What follows from a finding.** An established finding earns one attempt from the run's existing
attempt cap, under the ratchet. The brief gives, for each case:

- the basis, with its quote;
- the input;
- the expected answer and where it comes from;
- what each tree gave;
- the probe's program.

The brief also says to leave the code as it is where the task authorizes the change, and to say
which. After the attempt, every probe runs again on the candidate:

- Each probe's kept cases are ratchet parts, so a repair that breaks a case the incumbent
  satisfied is rolled back to the incumbent.
- A requested case is a claim. It yields to a repair that restores base-backed behaviour, as
  planned claims do.
- The same holds for every later candidate, so a passing reading is never reused after the tree
  changes.

**What a finding never does:**

- decide acceptance, or change a sealed gate;
- enter the final verification, which judges the delivered tree exactly as before;
- appear in the verdict. A finding still standing at the end is reported in the result's `review`
  block and, through its obligation, as `regressed`, labelled as the reviewer's proposal.

**Prose mode** is the control. It runs the same conversation and the same attempt, the reviewer
answers with objections in words, and nothing runs. It tells executable feedback apart from extra
computation.

**Cost.** The reviewer takes at most:

- ten steps;
- a quarter of the remaining tokens;
- 30% of the remaining wall, capped at four minutes.

The probes cost two fresh checkouts. The review is withheld, on the record, where what is left
cannot pay for it, its probes, an attempt and the cycle that measures it. Every token and step is
charged to the run's own allowance, and the verification reserve is untouched.

## Limits

- The reviewer is the same untrained local model with a different prompt, not a separately
  trained test agent. In ExecCritic ([arXiv 2609.09133](https://arxiv.org/abs/2609.09133)) the
  untrained Qwen 35B test agent's tests lowered the resolve rate.
- A probe's inputs are the reviewer's choice. A preservation probe on an input the task
  authorizes changing reports a regression that is not one. The worker is told it may leave the
  code, and the report labels the probe a proposal, but nothing here can tell such a probe from a
  real regression.
- A requirement probe's expectation is a reading of the task. Execution shows what each tree
  does, not that the reading is right.
- Probes call the project through its module exports with JSON inputs and JSON results. Behaviour
  that needs a process, a file system fixture or a browser is out of their reach.
- An authorized behaviour change that rewrites an existing test's expectation is left
  `unverified` by the final verification's base-tests reading, review or not
  (`src/cli-review.integration.test.ts` keeps that case as a documented limit).

## Evidence

The deterministic controls are in `src/cli-review.integration.test.ts`. Each drives the ordinary
command line on a scripted model, through the real gates, ratchet and final verification, and then
the bundle's own `verify.mjs` and `rederive.mjs`:

- a correct change;
- a plausible change that breaks an old case, repaired;
- an authorized change a probe calls a regression, delivered;
- a weakened test hiding damage, refused;
- a wrong expectation whose damaging repair is rolled back;
- broken probes that establish nothing;
- the prose control.

Live results are in [the stage's evidence](evidence/2026-10-23-preservation-review/README.md).
In the development study the review established 3 findings, and the offline assessor rated all 3
as false accusations against the reference. Its 5 attempts changed no hidden verdict. In the fresh
block it was never asked, because no Swarm run's gates went green. It stays off by default.
