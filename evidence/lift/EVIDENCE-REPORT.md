# Viability lift, witness hardening, Hunt 4: evidence report

The capstone for the run that set out to raise the executable surface, fix the two
claim-differential defects the Hunt 3 autopsy found, complete the credit-blocked
measurements, and run a pre-registered Hunt 4 with real reach. Branch point
`7c8686355058bd209d33cac7b5a6adc3cb2a6312`; all work is on `main`. Both credentials
failed at the start (Anthropic 400 credit-too-low, GITHUB_TOKEN 401); the maintainer
topped up $20 of Anthropic credit mid-run, which unblocked the funded measurements.
The GitHub token stayed 401 throughout, so Phase 4 stayed blocked.

Every number below carries its n and the script that regenerates it. Honest zeros
and honest blocks are written as findings.

## Per-phase commit map

| phase | commits |
| --- | --- |
| 0 baseline | `5197b664` |
| 1 census (roadmap, first) | `b5a98ce3` |
| 1 corepack-shim install fix | `51493b4c` |
| 1 node-engine OR fix | `701e6292` |
| 1 lift report + provision proof | `114ae892` |
| 2 claim-differential hardening (code+tests) | `a6c5b598` |
| 2 hardening report | `bdb8ea4c`, `17c7c65f` (funded update) |
| 5 Hunt 4 pre-registration + instrument (before any artifact) | `e365ea08` |
| 5 Hunt 4 result + outline diagnosis | `11b33cd7`, `3917e7ee` |
| 3 judge gate-cost (funded) + sentence correction | `1fb97073` |
| deliverable (this file) | committed last |

## Phase 0: baseline

Probes recorded in `evidence/lift/BASELINE.md`. At branch point: Anthropic HTTP 400
credit-too-low (`req_011CcoWFZj9hkabrUXt67Jqc`), GITHUB_TOKEN HTTP 401. Suite green:
**2137 passing, 39 pending, 0 failing**. Mid-run the maintainer added $20 credit; a
re-probe returned 200, reopening Phases 2-validation, 3, and Hunt 4's
claim-differential.

## Phase 1: viability lift (the biggest lever) — done

Census first (`benchmarks/real-prs/hunt3/VIABILITY-CENSUS.md`, `b5a98ce3`, committed
before any provisioner), then two root-caused fixes, then a lift report with real
command output. Regenerate: `npm run viability-census`, then
`SWARM_EG_NODE_BIN=<node22> node dist/scripts/real-prs/hunt3-provision-proof.js`.

- **Proof-executable (Node tier can run): 6 → 7.** outline/outline#12197 was a
  node-engine false-negative: its `>=20.12 <21 || 22 || 24` range admits Node 22 via
  the `|| 22` clause, but the screen treated the first `<21` as a global upper bound.
  Fixed by splitting on `||` and admitting when any alternative admits the pinned
  major (`701e6292`), unit-tested on synthetic engine strings. `provision-proof.json`
  shows outline now provisions (yarn/jest).
- **Provisioned: 4 → 6.** yorickdewid/flight-planner#149 install failed because the
  sandbox PATH lacked a `pnpm`/`yarn` entrypoint, so its `prepare` script died
  `sh: 1: pnpm: not found` even though the frozen install succeeded. Fixed by
  prepending a corepack pnpm/yarn shim dir to the sandbox PATH (`51493b4c`), with a
  fail-open unit test. `provision-proof.json`: flight-planner now provisions
  (pnpm/jest).
- **Honest not-provisioned: inmanta/web-console#6972.** Its install needs
  `@joint/plus` from the JointJS paid private registry; anonymous access returns
  `YN0041 Invalid authentication`. Not a tool bug and not recipe-fixable; recorded,
  not forced.
- **Every entry that stays out is recorded with its reason** (`VIABILITY-LIFT.md`):
  7 install-viable pytest/Go where the Node tier abstains, 4 lockfile-less monorepo
  Node subpackages (frozen-lockfile discipline refuses them), 5 unsupported
  languages, 2 no-runner Node repos, 1 Python-no-pytest, 1 gone (404).

The corpus ceiling is structural: it is dominated by non-Node and non-project
repositories the Node proof tier cannot execute on.

## Phase 2: claim-differential hardening — done, confirmed live

Three defects fixed (`a6c5b598`), unit-tested against synthetic stubs and fixture
workspaces only (held-out discipline), then confirmed live in Hunt 4:

1. **witness-not-compiled → gone.** A structured-output contract
   (`output_config.format`) plus `effort:low` so reasoning cannot starve emission,
   reasoning stripped before parse, one format-only retry. Hunt 4: **0
   witness-not-compiled across 6 provisioned entries, down from 3 in Hunt 3** — every
   witness compiled (`witnessRetried: false`).
2. **closure-unlinked recovery.** The compiler is fed the behaviorally-revertable
   changed files and their exported symbols; the witness import closure is validated
   statically before any sandbox run; an unlinked witness is regenerated once naming
   the exact files. Hunt 4: fired live on poetry-bil-araby
   (`regeneratedForClosure: true`); the closure control is byte-identical.
3. **Temperature conformance, honestly.** `claude-sonnet-5` rejects an explicit
   temperature (HTTP 400), so it stays unset and the sampling policy, model id, and
   prompt version (cw-v2) are recorded on every witness and into the ledger —
   closing the reproduce-section contradiction by recording, not faking a pin.

**The gap the funded run surfaced.** On outline the hardened engine returned
`claim-falsified-synthesized`. The diagnosis (below) shows it is a false positive:
`claim-falsified-synthesized` ("base fails AND head fails") lacks a
discrimination/positive control, so a witness that fails identically everywhere for
its own setup reasons is mis-scored. That control is detection logic; held-out
discipline forbids building it from the wild entry that exposed it, so it is
disclosed future work validated on twins (`CLAIM-DIFFERENTIAL-HARDENING-REPORT.md`).
The Phase 2 acceptance gate as literally specified (zero findings on the
semi-synthetic twin *set*) has no provisioning instrument — the twins are
diffs-over-external-PRs, mostly Python — so it was not run on the twin set; the
funded wild evaluation is the evidence instead.

## Phase 3: judge gate-cost — run (funded), sentence corrected

`npm run judge-gate-cost` (`1fb97073`): **124 verdicts, $0.5375** (haiku-4-5,
content-cached). Measured operating point (`judge-gate-cost.json`,
`JUDGE-GATE-COST-REPORT.md`):

| set | n | judge blocks | Wilson-95 |
| --- | --- | --- | --- |
| semi-synthetic clean | 8 | 1 (13%) | [0.02, 0.47] |
| semi-synthetic cheat (recall) | 8 | 8 (100%) | [0.68, 1.00] |
| broad clean | 44 | 0 (0%) | [0.00, 0.08] |
| wild goal-not-fixed (recall) | 7 | 1 (14%) | [0.03, 0.51] |

The K=5 self-consistency FP holds 13% at every threshold 0.2–1.0 because the single
false block is unanimous (5/5). The overreaching sentence ("the judge cannot reach
zero false positives while keeping nonzero recall") was replaced with the measured
n=8 result stated with its Wilson bounds and a small-n caveat — the data supports
the direction on this sample, but the interval is wide and it is not a general
impossibility. Folded into the leaderboard as a sidebar. Measurement logic
untouched.

## Phase 4: corpus growth — blocked (token-gated), recorded

The complaint-mine workflow dispatch needs a valid GITHUB_TOKEN. The token returned
401 at Phase 0 and again on the mid-run re-probe. Public unauthenticated fetch
worked for everything else, but a GitHub Actions workflow dispatch cannot run
without a valid token, so **no fresh entries were mined or folded**. This is why
Hunt 4's primary (post-freeze) set is empty and the rematch is disclosed as
confirmatory-only. Recorded, not worked around.

## Phase 5: Hunt 4 — 0 truly-proven of 7, with the stop-the-line receipt

Pre-registered (`benchmarks/real-prs/hunt4/PREREGISTRATION.md`, `e365ea08`, before
any run artifact). Run over the 7 now-proof-executable entries
(`benchmarks/real-prs/hunt4/HUNT-4-REPORT.md`, `11b33cd7`).

Funnel: 27 frozen → **7 proof-executable (was 6)** → **6 provisioned (was 4)** →
restoration proofs 0 → claim-differential raised 1 `claim-falsified-synthesized`
(outline) → **0 truly-proven**. The hardening's effect vs Hunt 3: witness-not-compiled
3 → 0; the engine now reaches the real controls (3 arbiter-disagreement, 2
closure-unlinked).

**The outline finding is a diagnosed false positive, not a proven cheat.** The
runner flagged outline/outline#12197 `proven-block`. The stop-the-line diagnosis
(`hunt4-diagnose-outline.ts`, `outline-diagnosis.md`, 3 re-runs) established:
(1) it fails proven-definition part 3 — the synthesized witness is not persisted
(the workspace is deleted) and is nondeterministic, so a fresh-clone replay is
impossible → `proven-not-replayed`; (2) the verdict is not robust (1/3 errored,
2/3 falsified); (3) the witness tests a *cached* `memberCount` via raw
`GroupUser.create()` without the CacheHelper mock the real suite uses, so its
assertion is false on **both base and head** regardless of the PR — it does not
discriminate. Per the pre-registration and the run's hard rules, this is never
recorded as proven. The truthful Hunt 4 proven count is **0**.

## Deviations (numbered)

1. **Anthropic credits topped up mid-run.** The maintainer added $20 after the run
   started. It unblocked Phases 2-validation-context, 3, and Hunt 4's
   claim-differential. No control or threshold changed; the pre-registration's
   expected credit-abstain deviation did not materialize (inmanta, the only entry
   finished before the top-up, made no model call).
2. **Invalid GITHUB_TOKEN (401) throughout.** Every fetch and clone routed through
   unauthenticated public GitHub, as in Hunt 3. Fetch infrastructure only; it did
   block Phase 4 mining (which needs an authenticated workflow dispatch).
3. **Phase 2 twin-set validation not run on the twin set.** No instrument provisions
   the semi-synthetic twin pairs through the claim-differential base/head path
   (they are diffs over external, largely Python, PRs). The funded wild evaluation
   (Hunt 4) is the substitute evidence, and it surfaced the false-positive path
   directly.

## Spend (against the $20 budget)

Recorded per phase, at the sonnet-5 introductory rate ($2/$10 per MTok) and haiku
($1/$5):

| phase | model calls | spend |
| --- | --- | --- |
| 0 probes | 1 haiku | ~$0.00 |
| 1 viability lift | none (infra) | $0.00 |
| 2 hardening (code) | none (unit tests) | $0.00 |
| 5 Hunt 4 claim-differential | 6 provisioned entries | $0.1373 |
| 5 outline diagnosis | 3 re-runs | ~$0.10 |
| 3 judge gate-cost | 124 verdicts | $0.5375 |
| **total** | | **≈ $0.78** |

Well under the $20 budget; ~$19.2 remains. The claim-differential and restoration
tiers are cheap because most work is deterministic (provisioning, restoration
proofs) and the model calls are short.

## What this run proved, and what it did not

- **Proved:** the viability lift is real and reproducible (6→7 proof-executable,
  4→6 provisioned, with command output); the three witness-compile defects are
  fixed and confirmed live (witness-not-compiled 3→0); the judge gate-cost curve is
  measured with honest n and bounds and the overreaching sentence corrected.
- **Did not prove a cheat:** Hunt 4 is 0 truly-proven. The one fire (outline) is a
  diagnosed false positive that exposed a real control gap
  (`claim-falsified-synthesized` needs a discrimination control). The gate stayed
  conservative and did not block on it.
- **Left as disclosed work:** the discrimination control (built on twins, not the
  wild entry); persisting the witness source so a claim-differential finding can be
  replayed; a twin-provisioning instrument for the Phase 2 acceptance gate; Phase 4
  mining when a valid token exists.
