# Mechanism study, registered before its first launch

October 24, 2026. This is a small live study of one mechanism, not a comparison of agents. Its two
tasks are exposed: their hidden verdicts were revealed on October 23, and the implementer has read
their task texts and earlier ledgers. It cannot show a general capability gain. It can show
whether the mechanism works end to end on real work.

## The mechanism and the hypothesis

The mechanism is the executable candidate review (`--review executable`, `candidate-review-v2`).
On these tasks the task text states what must not change, so the review can rest a finding on an
obligation the task states.

**Hypothesis.** The review produces a real counterexample to stated preservation. That
counterexample leads the repair to a different implementation, the repair is kept, and the
delivered artifact is more complete than the one the review read. Final verification then checks
that delivered artifact. The control does not get there.

The decisive evidence is that chain, observed in one launch:
1. **A real counterexample.**
   - An established finding (`preservation-regression`) whose case the reference solution answers
     as the base does.
   - Judged offline by running the probe's program on the reference tree, as
     `../2026-10-23-preservation-review/assess-findings.mjs` does.
2. **A different action.** The attempt the finding was owed changed the implementation (its
   candidate differs from the one reviewed).
3. **A kept repair.** The ratchet kept that candidate (`candidate-review-attempt-v1`, given and
   accepted).
4. **A better artifact.**
   - The hidden evaluator, run on the candidate before the review's attempt and on the delivered
     candidate, passes more on the delivered one: the kept check failing before and passing
     after, or the same for the behaviour check.
   - Both candidates are taken from the runner's own snapshots.
5. **Verification of that artifact.** The final verification's applied patch digest equals the
   delivered patch's digest.

These do not count as a capability gain:
- a changed verdict;
- a review that ran;
- lint cleaned up;
- a passing test suite.

## Before registration

One development launch was made to check that the mechanism executes live, on a task outside this
study:
- **The launch:** p-limit bug fix, from the October 23 development study, arm `swarm`, build
  `19840bdaa`.
- **What it showed:**
  - The review was asked.
  - The reviewer tried probes four times, and a fifth try was refused at the limit.
  - It submitted four probes, each naming a stated obligation by id. Three loaded and kept the
    base's answers, one was a defective program, and nothing was established.
- **No change followed.** Nothing was changed because of that launch. It does not count, and it
  is reported separately.

## Arms, tasks and launches

- **Build and model.**
  - One pinned build, `19840bdaa`. The commit that registers this protocol changes no product
    code after it, and the revision is recorded in the frozen manifest.
  - Model `qwen3.6:35b-a3b` through local Ollama, one sequence at a time.
- **Arms:**
  - `swarm`: `--adaptive --review executable`.
  - `swarm-control`: `--adaptive`. The same build and model, with the review off.
  - Everything else is identical: budgets, permissions, starting trees, the supplied goal
    contract, the gate plan.
- **Tasks:** `ufo-bugfix-base-prefix-boundary` and `ufo-feature-filter-query`, from the October
  23 held-out tasks, unchanged.
- **Samples:** two per arm and task, so eight launches, in the frozen order (task by task,
  alternating the arm that goes first).
- **Budgets** are the October 23 block's:
  - 720.5 s wall per launch, plus 59.5 s grace;
  - an 8,000,000 token cap;
  - a 60 s verification reserve.

  No budget is raised for either arm.
- **Failure and replacement.** The runner's registered rules
  (`scripts/comparison/study.mjs`):
  - A launch that stops before its arm made any model request is a setup failure. It is
    recorded, and the same launch is tried again after a recorded correction, at most
    `setupRetries` times.
  - Once a model request was made, the outcome stands, whatever it is.
  - Every launch runs.
- **No coaching.** Nothing changes between launches. The implementer watches only for a hung or
  stalled process (liveness, wall and CPU), not at verdicts or artifacts, until all eight have
  ended.

## Measures, after all eight have ended

Per launch, read from the records and the frozen hidden evaluator:
- whether the review examined or was withheld, and why;
- its probes, which loaded and which established anything;
- each established finding, judged as a real counterexample or a false accusation against the
  reference;
- the attempt it was owed: given, kept or rolled back, and what it changed;
- missed regressions: the delivered candidate fails the hidden kept check and no finding
  named it;
- useful repairs: the chain above;
- final correctness:
  - the hidden verdict;
  - the stricter audit's reading (requested behaviour, kept behaviour, requested tests, new
    static or test failures), from `audit/audit-study.mjs`;
- accepted delivery: the product accepted, and the artifact is correct;
- total cost: wall, tokens, unknown-usage calls.

## Stop rule

- **No full chain in any launch.** There is no expansion. The first concrete failure along the
  chain is diagnosed from the records and reported, and no other mechanism is added to
  compensate.
- **The chain in at least two `swarm` launches, and in none of the control's.** A separately
  frozen held-out comparison may follow, if budget remains:
  - across a bug fix, a feature and a refactor;
  - with the ablation and an external agent;
  - under its own registered protocol;
  - with its evaluator material inaccessible throughout.
- **Exactly one launch.** One launch is noted as not yet repeated.

With two samples per cell, a difference of one or two launches is within chance, and nothing here
supports a claim of superiority over coding agents in general.
