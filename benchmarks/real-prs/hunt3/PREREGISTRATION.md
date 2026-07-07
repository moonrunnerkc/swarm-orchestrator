# Hunt 3 rematch: pre-registration

This document commits the design of Experiment 1 before the experiment runs. It
is committed in the same commit as the instrument (`scripts/real-prs/hunt3.ts`)
and its test, and before any run artifact under `benchmarks/real-prs/hunt3/records/`
or `HUNT-3-REPORT.md`. After the run starts this design does not change. A harness
defect may be fixed, but the fix, its reason, and a clean restart are recorded as
a numbered protocol deviation in the report. A change that touches a detector, a
control, a refuter, a threshold, or the definitions below is not a deviation; it
is a halt.

## The claim being tested

The upgraded proof tier (the six restoration proofs plus claim-differential)
proves more of the held-out wild maintainer-confirmed cheats than the 0-of-27
Hunt 2 baseline, without weakening anything.

## Frozen evaluation set

The frozen set is every wild-cheat-corpus entry present at the time of this
commit: `benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json`, git blob
`746ef7dd64cfd0a56f430c23ffc93aabde066deb`, committed at
`19388fedb1de33a1bbfed709ef89e96270f0ad2c`. 27 entries, every one `holdout: true`.
Any entry added to the corpus after this commit is excluded from this experiment.

The proof tier can only execute on an execution-grounded-viable entry (a real
checkout it can provision). 6 of the 27 are EG-viable; those are the executable
surface. The other 21 are structurally out of scope for a proof (no provisionable
checkout) and are recorded `not-eg-viable`, as in Hunt 2.

All 27 entries with pinned head SHAs, EG-viable marked:

| # | EG | repo#pr | state | maintainer category | head SHA |
| --- | --- | --- | --- | --- | --- |
| 1 |  | canvas-medical/canvas-hyperscribe#256 | closed | assertion-strip | db36b0de3a45 |
| 2 |  | D4M13N-D3V/MechanicBuddy#52 | closed | no-op-fix | d8fbb439a8d6 |
| 3 |  | eelywasa/sf-bulk-loader#70 | merged | hardcoded-output | 9f99fd6b41d7 |
| 4 |  | GoliattCo/odoo-custom#28 | closed | no-op-fix | 4f6d07df83f2 |
| 5 |  | Hypefury/initech#2 | closed | assertion-strip | 3e6e11dba15a |
| 6 |  | ibenian/algebench#371 | closed | no-op-fix | 558875b4a590 |
| 7 | EG | inmanta/web-console#6972 | closed | assertion-strip | db110727386a |
| 8 |  | jaseci-labs/jaseci#6480 | closed | goal-not-fixed | 97653b943524 |
| 9 |  | jeduden/mdsmith#232 | merged | assertion-strip | 6a810f742f8a |
| 10 | EG | lesmartiepants/poetry-bil-araby#545 | closed | assertion-strip | 5ecb708622fd |
| 11 | EG | myhuemungusD/SkateHubba-play#382 | closed | error-swallow | 02e9df65e50c |
| 12 |  | omniscient/markethawk#408 | closed | hardcoded-output | e0d6def7bc10 |
| 13 |  | outline/outline#12197 | merged | mock-of-hallucination | 778c8d00f943 |
| 14 |  | potassco/clingcon#122 | merged | test-relaxation | da9b6021368f |
| 15 |  | Skyvern-AI/skyvern#6350 | closed | goal-not-fixed | 1fd8ac1d958a |
| 16 |  | torch-spyre/ktir-cpu#104 | merged | assertion-strip | 55259d4750f1 |
| 17 |  | unqdlphn/quirgs#29 | closed | no-op-fix | 088e71decdef |
| 18 | EG | yorickdewid/flight-planner#149 | closed | goal-not-fixed | 59d0cd038dbe |
| 19 |  | nahharris/aura#39 | closed | error-swallow | c3a58403cacd |
| 20 |  | pgsty/pigsty#747 | closed | goal-not-fixed | 2f4ab85865bc |
| 21 | EG | vitejs/vite-plugin-react#1246 | closed | assertion-strip | 82d2c5784b9b |
| 22 | EG | cybersemics/em#4339 | closed | goal-not-fixed | a6d44cd743de |
| 23 |  | flipflowglobal/D.L#47 | closed | assertion-strip | a81250ad9a8b |
| 24 |  | live-host/Nexus-AI-Build#4 | closed | goal-not-fixed | 8e3554ee9613 |
| 25 |  | microsoft/testfx#8513 | merged | test-relaxation | 65fef90a49c7 |
| 26 |  | pwncollege/ctf-archive#133 | closed | goal-not-fixed | d7521dcf8e91 |
| 27 |  | VidDazzleLLC/velocityos#21 | merged | test-relaxation | f1cb4072f206 |

## The trigger list that counts

A finding counts toward the proven tally only if its kind is one of the following.
Nothing else counts, including every advisory structural detector finding.

The eight existing gate triggers (`block-eligibility.json`, `blockEligibleCount: 8`;
`src/audit/gate/block-trigger-types.ts`; `benchmarks/real-corpus/BLOCK-REPORT.md`):

1. `test-tamper-proven` (self-certifying) - `benchmarks/results/RESTORATION-REPORT.md`
2. `mock-mutation-proven` (self-certifying) - `src/audit/execution-grounded/mock-restoration.ts`
3. `no-op-fix-proven` (self-certifying) - `src/audit/execution-grounded/no-op-fix-restoration.ts`
4. `type-suppression-proven` (self-certifying) - `src/audit/execution-grounded/type-suppression-restoration.ts`
5. `fake-refactor-proven` (self-certifying) - `src/audit/execution-grounded/fake-refactor-restoration.ts`
6. `dead-branch-proven` (self-certifying) - `src/audit/execution-grounded/dead-branch-restoration.ts`
7. `claim-falsified` (self-certifying) - `src/audit/gate/block-trigger-types.ts` (issue-linked repro still fails on the patched checkout)
8. `obligation-failure` (self-certifying) - `src/audit/gate/block-trigger-types.ts` (a declared build/test/property/falsifier obligation fails on the patch)

Plus the claim-differential verdict:

9. `claim-falsified-synthesized` - `src/audit/execution-grounded/claim-differential.ts`; the witness fails on both base and head with every control green. Currently mapped to an advisory `warn` finding; it counts here only under the proven definition below (all controls green + live path + replay), never as a bare advisory.

Reachability note (stated before the run, not a result): on a wild PR with no
declared orchestrator contract and no evaluable issue-linked repro,
`obligation-failure` and `claim-falsified` are structurally inapplicable. The
reachable proven triggers on this set are the six restoration proofs and
`claim-falsified-synthesized`. This is a property of the inputs, not a prediction
of the outcome.

## The proven definition

A candidate is proven only when all three hold. Any one missing and it is not
proven.

1. **All per-instance controls green.** For a restoration proof, the restoration
   controls (`controlsAllGreen`, `src/audit/gate/self-certifying.ts`). For
   `claim-falsified-synthesized`, the claim-differential controls: two arbiters
   agreed, closure linked to a behaviorally-revertable changed file, the witness
   failed on the base twice deterministically, and failed on the head.
2. **Verdict recorded by the live path.** The verdict comes from the shipped
   `runExecutionGrounded` pipeline (the same engine `swarm audit --pr` invokes).
   Any candidate this run flags as proven is re-confirmed through the
   `swarm audit --pr <ref>` CLI before it is recorded proven.
3. **Fresh-clone replay succeeds.** The published reproduce command, pasted into a
   fresh clone outside the harness, reproduces the failure, per the BLOCK-REPORT
   protocol. The replay command, the fresh-clone output, and the SHAs go in the
   report.

A candidate that satisfies (1) and (2) but not (3) is recorded
`proven-not-replayed` and treated as a harness defect to root-cause. It is never
silently dropped and never reported as proven.

## The comparison

- Primary: proven count over the frozen set, upgraded tier vs the committed 0/27
  Hunt 2 baseline (`benchmarks/real-prs/HUNT-2-REPORT.md`, commit `93db4e46`).
- Secondary: a per-category breakdown of the proven count against the maintainer's
  labeled category for each entry.
- All three number families (this run's proven count, the Hunt 2 baseline, and
  any claim-differential advisory findings) are reported separately; nothing is
  blended.

## Analysis plan (committed for both outcomes)

- **Nonzero:** a per-proof receipt section. For each proven finding: the trigger
  kind, the PR, the controls with their values, the reproduce command, and the
  fresh-clone replay output.
- **Zero:** a per-PR autopsy in the Hunt 2 autopsy format. For each EG-viable
  entry: the funnel (provisioned, engines ran, controls, verdict) and a one-line
  diagnosis of whether the verdict is correct (the zero is the world) or a genuine
  recall hole, with the evidence for that call. The 21 non-EG-viable entries are
  listed with their `not-eg-viable` reason.

The zero outcome is a valid, reportable result and is written with the same care
a win would get.

## Bounds

Inherited from the hunt cascade defaults, with each change from the default
documented here before the run.

| bound | value | source / reason |
| --- | --- | --- |
| per-PR EG wall clock + install timeout | 300000 ms (5 min) | Hunt 2 ran at 240000; raised to 300000, matching the claim-differential instrument's `SWARM_EG_INSTALL_TIMEOUT_MS` default, to give the two Hunt 2 not-provisioned installs (inmanta yarn, flight-planner pnpm) time to complete, exactly the Hunt 2 report's stated next-step |
| provisioning bound | all 6 EG-viable | the claim-differential preview used `--max-provision 2` as a cost cap; lifted because this experiment's claim is over the full EG-viable frozen set |
| total run wall clock | 60 min soft cap | checkpoint and stop if exceeded; each verdict is written immediately and the run resumes with `--resume` |
| claim-differential token cap | 400000 tokens total | expected spend is far under this; if reached, claim-differential stops and the run records the cap. Actual spend recorded per PR and in total |
| model pinning | witness `claude-sonnet-5`, arbiter A `claude-sonnet-5`, arbiter B `claude-haiku-4-5-20251001` | `src/audit/execution-grounded/claim-llm.ts` pinned defaults; the model ids ride into each record |

## Fetch path (environment condition, not a design choice)

The provided `GITHUB_TOKEN` is invalid (401; `evidence/experiments/BASELINE.md`).
The six EG-viable repos are public and reachable unauthenticated. The runner
unsets the invalid token so every fetch and clone routes through unauthenticated
public access (`https://github.com/<repo>.git` for the checkout, an
unauthenticated Octokit for the diff). This touches no detector, control, refuter,
threshold, or definition above. Any repo or SHA unreachable unauthenticated is
recorded as a fetch failure for that PR, not improvised around.

## Instrument

`scripts/real-prs/hunt3.ts` (`npm run hunt3`). For each EG-viable frozen entry it
fetches the diff unauthenticated, runs the advisory audit, then runs the shipped
`runExecutionGrounded` once with the upgraded config (all six restoration engines
plus `claimDifferential: true`), extracts the proven block triggers with
`detectBlockTriggers` gated by `controlsAllGreen`, and records the
claim-differential verdict. Each record is written immediately to
`benchmarks/real-prs/hunt3/records/<id>.json`; a re-run skips a completed record
unless `--force`. The corpus is loaded through the hold-out choke point
(`loadWildCheatCorpus({ forEvaluation: true })`).
