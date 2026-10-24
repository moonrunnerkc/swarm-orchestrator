# Design note: verify what a candidate preserved, and review it with executable probes

October 23, 2026, written before implementation. It states what is being tried and what would
show that it does not work.

## The recurring failures

The October 23 controller stage ([report](../2026-10-23-controller/README.md)) and the stages
before it show two kinds of failure, and they need different remedies.

1. **Correct work refused (delivery).** Both complete refactor deliveries of that stage were
   refused. The stage attributed both to the instrument rule. The records show more than that:
   - **markdown-it rename, sample 1.** The `build` check was withheld because the patch changed
     `support/build-dist.mjs` (its entry `index.mjs` to `index.ts`, four times), and the base's
     version cannot build a tree where the `.mjs` entry no longer exists. Task acceptance failed
     for that reason alone. The diff-budget justification was never asked for, because it is
     asked only once the gates are green.
   - **fastify rename, sample 1 (`swarm-previous`).** The `lint` check was withheld for the same
     kind of change (`eslint.config.js` ignores `lib/configValidator.js`, now
     `lib/config-validator.js`), and so was the `tests` check: the base's versions of eight test
     files `require` the old paths, so they fail against the renamed source and read as weakened
     tests. Separately, the file-set gate failed on its own terms: the worker declared the old
     names and never amended the set for the eleven new ones. That is a real policy failure, so
     this candidate would not be delivered even with the instrument corrected.

   Every instrument difference in both patches is a path moved along a rename the same patch
   makes.
2. **Wrong work delivered or accepted (artifact).** In the fresh block all six svgo launches
   missed a case the task names. Two markdown-it feature launches broke the linkify override,
   which is a preservation regression. On October 16 an accepted node-tar patch broke an
   explicitly preserved field, and held-out block 1's p-limit lost the synchronous-throw
   behaviour the task named. No gate exercised any of these. Swarm reported five false accepts
   in the fresh block.

## Research ideas adapted, and how Swarm differs

- **ExecCritic** ([arXiv 2609.09133](https://arxiv.org/abs/2609.09133)) separates the test author
  from the repair author, so one trajectory does not grade its own patch. A fail-closed harness
  qualifies a test bundle (a clean failure on the base), freezes it, and the repair agent revises
  source from its execution feedback without changing the tests.
  - Its own numbers are the main caution. With the untrained Qwen 35B-A3B test agent, the
    resolved rate *fell* from 61.2% to 57.3%. Only post-trained or stronger-model tests helped,
    and Base-to-Gold success for the untrained model was 22.2%.
  - The authors state that a clean base failure "does not by themselves prove that the test is
    semantically aligned with the issue".
  - Swarm runs an untrained `qwen3.6:35b-a3b`, the same family, with role prompts. A role prompt
    does not reproduce that paper's separately trained test agent.
- **TestJack** ([arXiv 2610.10619](https://arxiv.org/abs/2610.10619)) generates tests per trial,
  aimed at the requirements that trial's patch may violate. It keeps only the tests that the
  ground-truth patch passes, and backs each confirmed failure with a replayable test. It found
  that about 34.4% of trials judged correct violate their task.
  - Swarm keeps the per-candidate targeting and the replayable-test standard.
  - It cannot use the ground-truth filter: an ordinary user task has no reference patch.
- **RETRACE** ([arXiv 2608.08950](https://arxiv.org/abs/2608.08950)) reconstructs from the patch
  what the patch actually does, independently of the implementer's account. Swarm keeps the
  stance: the reviewer is given the diff and the task, never the implementer's narrative as fact.
  It does not adopt RETRACE's model-judged alignment verdict, because a blocking model judgment is
  a non-goal here.
- **Anthropic harness and evaluation notes**
  ([harness design](https://www.anthropic.com/research/harness-design-long-running-apps),
  [agent evals](https://www.anthropic.com/research/demystifying-evals-for-ai-agents),
  [infrastructure noise](https://www.anthropic.com/research/infrastructure-noise)) contribute:
  - a separate evaluator is easier to make skeptical than a self-critical generator, but out of
    the box it "talked itself into approving" real issues;
  - every harness component encodes an assumption to retest;
  - grade outcomes, read transcripts, isolate trials;
  - treat a lead of a few points as possibly infrastructure.

The adaptation that matters for this model is **who supplies the expected answer**:

- **A preservation probe.** The reviewer chooses only the scenario: a program that calls the
  project and the inputs to call it with. The harness runs it on the base and takes the base's
  observed answer as the expectation, so no model writes an expected value. Baseline behaviour is
  not automatically correct, so an input whose behaviour the task authorizes changing is excluded
  by a quote of the task naming it. That exclusion is recorded as the model's reading.
- **A missed-requirement probe.** The reviewer writes the expected answer, quoting the task. It
  remains the model's reading of the task, reported as such, and never an acceptance check.

Execution establishes what the two trees did with those inputs. It does not establish that the
inputs were the relevant ones, or that the reading of the task is right.

## Smallest implementation

1. **Rename transport (delivery).** Pair the patch's deleted and added files whose contents are
   equal once each reference to a renamed file is moved with it, and verify every pair under the
   final rename map. Then an instrument file, or a base test file, whose change is only such moved
   references is read as the base's own instrument or test, transported. Every other
   configuration edit is treated as before: withheld, and read again under the base's
   configuration. The rule is mirrored in the standalone verifier from the recorded digests.
2. **Preservation obligations.** One record per run, written before the first model call, that
   ties each obligation to its source:
   - authoritative: task sentences about what to keep, and supplied contract requirements;
   - observed: the base's suite;
   - model-proposed: review probes, which arrive later.

   Each obligation gets a status from what actually ran. Unmeasured stays unmeasured, and an empty
   set is reported as nothing measured, never as preserved.
3. **Candidate review (experimental, off by default, `--review`).** Once the gates are green, a
   separate conversation receives:
   - the task text and the candidate diff;
   - the preservation obligations;
   - the current check results;
   - read, list and search tools, plus one tool to declare probes.

   The harness then runs the probes on fresh base and candidate checkouts, twice each, through the
   existing planned-check runner. It classifies every case as:
   - a preservation regression;
   - a missed requirement against a quoted expectation;
   - unstable;
   - a defective program, or failed to load;
   - timed out;
   - unsupported, which covers a case that does not tell base and candidate apart, and an
     expectation the base already meets.

   An established finding gets one bounded repair attempt, from the existing attempt cap and
   under the ratchet. After the repair every probe runs again. A repair that breaks a kept case
   the incumbent satisfied is rolled back to the incumbent. Probes stay diagnostics: they never
   decide acceptance and never change a sealed gate.
4. **A prose control** (`--review prose`) spends the same reviewer conversation and the same repair
   attempt with no executable probes. This tells executable feedback apart from extra computation.

## What would disprove the hypothesis

The hypothesis: a separate review of the actual candidate finds a missed requirement or a
preservation regression, its executable feedback is correct and useful, and the repair it drives
produces a correct artifact within the original budget. Any of these observations, on the
deterministic controls or the registered development study, would count against it:

- On candidates the offline assessor knows are correct, the executable arm reports established
  findings, which are false accusations. Or its repair attempts damage correct candidates more
  often than they repair faulty ones.
- On faulty candidates it establishes no finding the offline assessor confirms. Or its findings
  are established and the repair still does not produce an artifact the hidden evaluator
  accepts.
- It does no better than the equal-budget prose control on complete correct artifacts. That would
  mean any benefit is the extra computation, not the executable feedback.

If the hypothesis fails, the mechanism stays off by default and experimental, or is removed. The
rename-transport correction stands or falls on its own controls.
