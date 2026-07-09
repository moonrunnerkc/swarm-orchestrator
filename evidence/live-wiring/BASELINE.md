# Live-wiring run: baseline (Phase 0)

Frozen before any wiring change. This run closes capability-run **deviation 3**:
the error-swallow engine and the Tier C claim-to-existing-test binder ship
twin-validated and advisory but are NOT wired into the shipped `swarm audit`
pipeline, so they never fire on a live audit. This run wires them (plus the
derived-witness attestation surface), proves the complete set end-to-end through
`swarm audit --pr`, and resumes the backfill hunt with the full tool.

## Branch point and probes

- **Branch:** `main` at `5ab9068b` (`docs(capability): close-out`).
- **Node:** v18.19.1. **npm:** 9.2.0. (Node 18 crashes eslint 10's `util.styleText`
  formatter on any finding; lint verified via `--format json`, per capability
  deviation 10. CI runs Node 20/22.)
- **Go:** go1.26.5 user-local at `~/go-toolchain/go/bin` (carried from prior runs;
  reversible, no sudo). **Python:** `/usr/bin/python3` + `pytest` at
  `~/.local/bin/pytest`.
- **Credentials (probed, values not printed):** both live ONLY when loaded from
  the project `.env` via `loadDotenv()`. `GITHUB_TOKEN` present (len 93),
  `ANTHROPIC_API_KEY` present (len 108). Bare shell env has neither, matching
  `machine_no_gpu` memory. Every audit in this run loads `.env` first.

## Toolchain / suite state (all gates green at branch point)

- `npm run build`: clean (tsc + asset copy + chmod).
- `npm run typecheck`: exit 0.
- `npm run test:ci`: **2311 passing, 39 pending**, exit 0.

## Spend cap

- **USD 5.00**, enforced by the cost ledger, spend recorded per phase. This run is
  deterministic-first: the error-swallow engine is model-free; the Tier C binder is
  deterministic-first (an arbiter may RANK candidate bindings but never creates one)
  and abstains in production without a green ref, so it makes 0 model calls on real
  PRs; the derived witness abstains in production by design. Expected spend at or
  near USD 0.00 unless a bounded model-ranked binding sub-experiment is run, capped
  and recorded per PR.

## Exact wiring state of the three engines (the thing this run changes)

Confirmed by grep over `src/audit/execution-grounded/index.ts`,
`src/cli/v8/audit-handler.ts`, `src/audit/attestation/*.ts`, and
`src/audit/cheat-detector/audit-config.ts` (all four returned empty for the new
engine identifiers):

| engine | src present | twin-validated | wired into live `swarm audit`? | config flag | attestation row | ledger kind |
|---|---|---|---|---|---|---|
| **error-swallow restoration** (`error-swallow-restoration.ts`) | yes | 4/4 (`error-swallow:measure`) | **NO** | none | absent | absent |
| **Tier C claim-binding** (`claim-binding.ts`) | yes | honest FP 0/4, recall 4/4, sep 1.00 (`claim-binding:measure`) | **NO** | none | absent | absent |
| **derived witness** (`scripts/gate/derived-witness-twins.ts`, `measure-derived-witness.ts`) | **no src engine** (measurement harness only) | 0/8 honest-twin FP, 8/8 special-casing recall (`derived-witness:measure`) | **NO** | none | absent | absent |

Neither `runErrorSwallowRestoration`, `error-swallow-restoration`, `runClaimBinding`,
`claim-binding`, `errorSwallowRestorations`, nor `claimBindings` is imported or
referenced anywhere in the live path. Both engines run today only from their
`scripts/gate/measure-*.ts` twin harnesses.

### Derived-witness diagnosis (shapes Phase 2)

The endgame run's "existing-test-derived witness" **added no `src`** (endgame
EVIDENCE-REPORT, Phase 3): it is a twin measurement harness under `scripts/gate/`,
not a production-callable engine. By design it **abstains in production**: the
output-changing subclass needs a spec-derived expected value the discrimination
control already rejects as unsound (the parked pass-capability research problem);
the output-preserving subclass needs an arbiter-certified output-invariant not yet
validatable on twins. There is therefore **no soundness-preserving production route
by which a pure synthesized derived witness produces a finding** — wiring it as a
live engine would mean it structurally always-abstains on every real PR.

Its production-viable descendant is the **Tier C claim-binding engine**, which
sidesteps the unsound synthesis by binding the claim to an EXISTING repo test whose
own green history is a real (not synthesized) pass-capability oracle. So this run's
honest reading of Phase 1 item 3 ("derived-witness verification or completion") is:
wire the claim-binding engine's attestation row to report the derived/bound-witness
**abstain in production** accurately, and keep the pure synthesized derived witness
a measurement harness (wiring an always-abstain src engine just to own a row would
be speculative architecture). Phase 2's hardcoded-output fixture is caught by the
derived-witness only on twins; through `swarm audit --pr` it abstains, and the
attestation must report that abstain correctly — which is the acceptance test.

## Pre-registration continuity (Phase 3 dependency, pre-checked)

The standing capability-hunt pre-registration (`2b9fc97d`,
`benchmarks/real-prs/capability-hunt/PREREGISTRATION.md`) ALREADY lists the two new
advisory finding kinds under "Advisory finding kinds (counted SEPARATELY from gate
triggers)": `claim-falsified-bound` (Tier C) and `error-swallow` load-bearing. Both
are advisory, neither is in the self-certifying gate-trigger list. The proven
definition, milestone definition, and FP protocol need no change. Phase 3 will
confirm coverage of the complete engine set and, if anything is uncovered, commit a
disclosed versioned amendment (proven/milestone/FP unchanged).

## Population state (Phase 3 dependency)

`benchmarks/real-prs/agent-corpus/sources.json` now holds **8** records (it held ~60
at capability-run time; the file was regenerated/shrunk since). The 30 PRs audited
pre-wiring in capability batches 1-2 are captured under
`benchmarks/real-prs/capability-hunt/records/` and are labeled **pre-wiring** in any
aggregate. Phase 3's target of >=100 PRs through the funnel needs a fresh
agent-attributed fetch (miner), for which `GITHUB_TOKEN` is live. Batch size <=15,
per-batch Anthropic spend USD 0.00 (deterministic gate), <=300 GitHub core calls per
batch, pacer-governed, checkpointed, resumable — per the pre-registration.

## Phase 2 mechanism (recorded, decided)

`swarm audit --pr` requires GitHub for both PR context/diff (`fetchPrContext`,
Octokit) and the sandbox clone (`provisionPRWorkspaces` clones
`https://github.com/<repo>.git` by SHA); there is no local-repo seam. The
established, accepted pattern in this workstream (closeout `LIVE-PATH-POLYGLOT-REPORT`,
4/4) is **private throwaway fixture repos under the maintainer's own account**
(`moonrunnerkc/swarm-eg-fixture-*`, not third-party), audited via
`swarm audit --pr`, with raw outputs committed so the verdicts stand after the repos
are deleted. Phase 2 follows that pattern (own repos, read-only w.r.t. everything
third-party); if the token lacks repo-creation scope, the fallback is a fail-closed
local fixture-provider seam, recorded as a deviation. Either way the GitHub
fetch/clone leg is separately proven (closeout 4/4) and re-exercised live by the
Phase 3 real-PR backfill.

## The wiring plan (per engine, one commit series each, FP-careful)

1. **error-swallow** (deterministic, model-free, lowest risk, first): new
   `errorSwallow` proof candidate (structural `error-swallow` `block` findings),
   dispatched in `runProofRestorations`; affected test files via the existing
   `selectAffectedTestFiles` inverse-closure helper; `errorSwallowRestorations` added
   to the outcome; no-workspace + budget-exhausted honesty records; proof envelope;
   `pr-audit-error-swallow-restoration` ledger kind; `error-swallow-restoration`
   attestation projector; config flag `errorSwallow` (default on, matching the
   on-by-default deterministic engines); `applyErrorSwallowRestorationToFinding`
   annotating the advisory finding (proven corroborates, refuted demotes; NOT a gate
   trigger).
2. **Tier C claim-binding** (deterministic-first, abstains in production): dispatched
   in `runExecutionGrounded`; deterministic existing-test candidate gathering + claim
   from PR title/body; `claimBindings` added to the outcome; `pr-audit-claim-binding`
   ledger kind; `claim-binding` attestation projector reporting the production abstain
   reason; config flag `claimBinding` (default off, matching `claimDifferential`).
3. **derived-witness completion**: the attestation/docs reflect that the Tier C
   binder is the production surface for the existing-test-derived witness and that the
   pure synthesized derived witness abstains in production; no always-abstain src
   engine is invented.

Existing behavior pinned before and after each wiring: the twin regressions call the
engines directly (byte-identical, unaffected by dispatch wiring), the FP registry
green, and the zero-false-block regression (block-eligibility + outcome-clean) re-run
green. Any firing on a clean fixture/twin/registry/outcome-clean PR is stop-the-line
in full.
