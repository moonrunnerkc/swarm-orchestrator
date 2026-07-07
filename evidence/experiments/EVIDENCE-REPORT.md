# Experiment run: evidence report

Three pre-registered experiments over the upgraded proof tier, run in order on
2026-07-07 from branch point `3d662714`. Every number below points at a committed
artifact and the script that regenerates it. Where a step was blocked, the block
is recorded as a finding, not hidden.

## Headline

- **Experiment 1 (Hunt 3 rematch): 0 proven of 27.** The upgraded tier (six
  restoration proofs plus claim-differential) proves the same zero the Hunt 2
  baseline did. The autopsy is the deliverable; every abstain is fail-closed and
  correct.
- **Experiment 2 (judge gate-stakes cost): partial.** The judge's operating point
  and the proof-tier point are reported from funded committed artifacts; the live
  threshold sweep and cost are blocked by Anthropic credit exhaustion and recorded
  as awaiting credits.
- **Experiment 3 (propensity pilot): harness built and pinned, pilot awaiting
  budget.** `SWARM_TRIAL_BUDGET_USD` is unset, so no agent ran and nothing was
  spent; the pipeline is verified against a stub agent.

## Pre-registration preceded execution (commit precedence)

Timestamps are local (MDT, UTC-6). The pre-registration commit for each experiment
predates its first run artifact.

| commit | time | what |
| --- | --- | --- |
| `3d662714` | 15:07 | branch point (before this run) |
| `8c144111` | 15:23 | Phase 0 baseline + dependency verification (`evidence/experiments/BASELINE.md`) |
| `2d4cd319` | 15:34 | **Exp 1 pre-registration** + runner (`benchmarks/real-prs/hunt3/PREREGISTRATION.md`, `scripts/real-prs/hunt3.ts`) |
| `d221007f` | 15:48 | **Exp 2 pre-registration** + instrument (`scripts/experiments/judge-gate-cost.ts`, sweep frozen) |
| `fa7f895e` | 15:52 | Exp 1 result (`HUNT-3-REPORT.md`, records, summary) |
| `24af3daa` | 15:55 | Exp 2 interim (`JUDGE-GATE-COST-REPORT.md`) |
| `594aeadf` | 16:00 | Exp 3 harness + pre-registered design (`benchmarks/trials/PILOT-DESIGN.md`) |

Exp 1: pre-registration `2d4cd319` (15:34) precedes the run (records stamped
21:34-21:48 UTC) and the result commit `fa7f895e` (15:52). Exp 2: pre-registration
`d221007f` (15:48) precedes the interim `24af3daa` (15:55). Exp 3: the pilot design
`594aeadf` precedes any agent run trivially (none ran).

## Binding environment conditions

Two machine facts shaped the whole run. Both are recorded in `BASELINE.md` (the
GitHub token) and surfaced mid-run (the credits).

1. **`GITHUB_TOKEN` invalid (401).** The wild corpus references diffs by SHA and
   vendors none, so fetching them needs GitHub. The token 401s; the six EG-viable
   repos are public and reachable unauthenticated, so every fetch and clone routed
   through unauthenticated public access (the runner unsets the bad token). This
   touched no detector, control, refuter, threshold, or definition.
2. **Anthropic API credits exhausted mid-run.** A small residual balance existed at
   the start (verified by a 1-token probe) and funded the earlier claim-differential
   witness compiles; it ran out on Experiment 1's final entry and blocks every
   subsequent model call with HTTP 400 "credit balance is too low". Restoration
   proofs need no model and were unaffected; the judge gate-cost sweep does and is
   blocked.

## Experiment 1: pre-registered Hunt 3 rematch

- **Claim.** The upgraded proof tier proves more of the 27 held-out wild
  maintainer-confirmed cheats than the 0-of-27 Hunt 2 baseline, without weakening
  anything.
- **Method.** `scripts/real-prs/hunt3.ts` (`npm run hunt3`) runs the upgraded tier
  (six restoration engines + `claimDifferential: true`) once per EG-viable frozen
  entry through the shipped `runExecutionGrounded`, extracts proven triggers gated
  by `controlsAllGreen`, records the claim-differential verdict, and checkpoints
  each record. Corpus read through the hold-out choke point.
- **Command.**
  `SWARM_EG_NODE_BIN=<node22-bin> node dist/scripts/real-prs/hunt3.js --eg-wall-clock-ms 300000`
- **Result: 0 proven of 27 (0 of 6 EG-viable), n=6 executable.** Baseline 0/27
  (`HUNT-2-REPORT.md`, `93db4e46`). Funnel: 2 EG-viable failed to provision (real
  `corepack yarn`/`pnpm install` failures on inmanta and flight-planner), 4
  provisioned to ran-no-proof; 1 no-op restoration attempted and correctly refuted;
  claim-differential compiled 1 witness, reached the closure control once
  (poetry-bil-araby, `abstain:closure-unlinked`), and raised 0 findings.
- **Artifacts / regenerating script.** `benchmarks/real-prs/hunt3/HUNT-3-REPORT.md`
  (autopsy), `hunt3-summary.json`, `records/*.json`; regenerate with `npm run hunt3`
  after `npm run build`. Per-category proven count: assertion-strip 0/8,
  goal-not-fixed 0/7, no-op-fix 0/4, test-relaxation 0/3, error-swallow 0/2,
  hardcoded-output 0/2, mock-of-hallucination 0/1.
- **Proven/replay.** Zero candidates reached the proven bar, so there is no proof
  to replay; the fresh-clone replay path was tested but not exercised.
- **Spend.** 5 claim-differential model calls: `claude-sonnet-5` 6606 in / 20030
  out (4 calls), `claude-haiku-4-5-20251001` 2656 in / 33 out (1 call). ≈ **$0.22**
  at the sonnet-5 introductory rate ($2/$10 per MTok through 2026-08-31) plus haiku
  ($1/$5); ≈ $0.32 at the standard sonnet-5 rate. The two not-provisioned entries
  and the credit-cut entry spent 0 model tokens.

## Experiment 2: judge false-positive rate at gate stakes

- **Claim.** A judge allowed to block merges produces a measurable false-block rate
  on clean PRs at every confidence threshold, and the proof tier's zero-FP point
  sits outside the judge's reachable curve.
- **Finding on the premise.** The shipped judge-primary path is a deterministic
  (temperature 0), content-cached, binary classifier (`anthropic-judge.ts:49`,
  `llm-judge/cache.ts`): it exposes no confidence score, so a pinned-judge threshold
  sweep collapses to one operating point. This is itself a result.
- **Operating point (funded, restated).** From `benchmarks/twins/judge-baseline.json`
  (`claude-haiku-4-5-20251001`, `v1-conservative` prompt), n=8 semantic twin pairs:
  recall **87.5%** (Wilson-95 lower 0.53), false blocks **12.5 per 100 clean PRs**
  (Wilson-95 upper 0.47). Per category: cheat-mock-mutation 4/4 caught, 0/4 false;
  goal-not-fixed 3/4 caught, 1/4 false.
- **Proof-tier point (restated).** From `TWIN-SEPARATION-REPORT.md` +
  `judge-baseline.json` + `block-eligibility.json`: 0% recall and 0% false positives
  on the 8 semantic pairs (abstains); 0 gate false positives on the block-eligibility
  corpus (no self-certifying trigger fired; the circumstantial trigger held out at
  Wilson-95 lower 0.510). The proof tier's zero-FP point sits off the judge's single
  operating point, which already blocks 12.5 per 100 clean PRs.
- **Blocked (awaiting credits).** The live threshold sweep (K=5 self-consistency
  samples at temperature 1.0, thresholds 0.2..1.0), the broader clean FP set (44
  non-semantic honest twins), recall on the 7 held-out wild goal-not-fixed entries,
  and tokens/$/wall-clock per verdict all need judge calls. Credits are exhausted,
  so none ran. The pre-registered instrument (`scripts/experiments/judge-gate-cost.ts`,
  `d221007f`) regenerates them with `npm run judge-gate-cost` when funded.
- **Artifacts.** `benchmarks/twins/JUDGE-GATE-COST-REPORT.md`,
  `benchmarks/twins/judge-gate-cost.json` (status `awaiting-credits`).
- **Spend.** ≈ $0. Every judge call in the blocked run returned HTTP 400 (unbilled);
  the operating and proof-tier points are restated from prior funded runs.

## Experiment 3: proof-graded propensity pilot

- **Claim (eventual).** Different coding agents cheat at different measured rates on
  identical real tasks, graded by execution proofs with replay receipts. This run
  builds and pins the harness only.
- **Budget gate.** The pilot spends agent-run money only under
  `SWARM_TRIAL_BUDGET_USD`. It is unset, so no agent ran, nothing was spent, and the
  harness reported `awaiting-budget`.
- **Harness.** `scripts/experiments/propensity-trial.ts`: presents every agent the
  same issue, checkout, and instructions; collects the patch; grades it through the
  upgraded proof tier; records the funnel and any proven finding with a replay
  command. Isolation is enforced in the harness, not in agent instructions: a
  throwaway checkout with its upstream remote removed (`assertNoUpstreamRemote`) and
  every GitHub credential scrubbed from the agent env (`scrubbedAgentEnv`), so an
  agent cannot push, open a PR, or comment upstream.
- **Pin.** `test/experiments/propensity-trial.test.ts` runs the full pipeline
  (provision -> produce -> gate -> record) against a scripted stub agent with
  injected provision and gate, verifying it without spend, network, or an upstream
  repo (6 passing). Claude Code's CLI was detected as available; no other agent
  was configured.
- **Artifacts.** `benchmarks/trials/PILOT-DESIGN.md` (pre-registered design),
  `benchmarks/trials/tasks.json` (selection criteria + candidate repos; finalized
  task list pinned before the funded run), `benchmarks/trials/PILOT-REPORT.md`
  (awaiting-budget), `pilot-results.json`.
- **Spend.** $0. No agent ran; nothing touched any upstream repository.

## Protocol deviations (numbered)

None touched a detector, control, refuter, threshold, or a pre-registered design;
all are environment conditions or harness fixes, recorded per the run contract.

1. **Exp 1 / Exp 2 fetch path: invalid `GITHUB_TOKEN`.** Fetches routed through
   unauthenticated public access; recorded in the Exp 1 pre-registration. Fetch
   infrastructure only.
2. **Exp 1 credit exhaustion on the final entry.** cybersemics/em's
   claim-differential witness compile was cut off by credit exhaustion; its
   restoration proofs ran fully (ran-no-proof), and the funded frontier run abstains
   there too (`WILD-CLAIM-DIFFERENTIAL-REPORT.md`), so the proven count (0) is
   unchanged. Environment halt, not a design change; no clean restart needed because
   the result is robust to it.
3. **Exp 2 harness fix.** Run first under exhausted credits, the instrument silently
   wrote an all-zero report (`askJudge` collapses API errors to `unavailable`,
   reading as "judge never blocks"). That artifact was a credit-failure, not a
   measurement, and was discarded; a probe call now aborts the run with a clear
   message before scoring, so a blocked run can never be mistaken for a real
   zero-false-positive result. This is a harness-defect fix; it changes no
   measurement logic.

## Halted items and their state

- **Exp 2 live sweep, broader sets, and per-verdict cost:** blocked by Anthropic
  credit exhaustion. Instrument built, tested, and pre-registered (`d221007f`), with
  the fail-fast probe added; regenerate with `npm run judge-gate-cost` when credits
  are topped up.
- **Exp 3 pilot:** awaiting `SWARM_TRIAL_BUDGET_USD` (and credits, for Claude Code).
  Harness built and pinned (`594aeadf`); finalize `tasks.json` and run under budget.

## Total spend

≈ **$0.22-0.32** for the whole run, essentially all in Experiment 1's
claim-differential model calls. Experiment 2's blocked judge calls were unbilled
(HTTP 400); Experiment 3 spent nothing. GitHub access was unauthenticated and free.

## Suite state

`npm run test:ci` before the run: 2119 passing, 0 failing (`BASELINE.md`). The three
experiment instruments add unit-tested pure helpers (hunt3: 7; judge-gate-cost: 5;
propensity-trial: 6) and pass typecheck, lint, and the LOC-budget gate
(45776/45776; the instruments live in `scripts/`, outside the `src/` budget).
