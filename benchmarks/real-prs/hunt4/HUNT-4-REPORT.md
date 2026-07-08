# Hunt 4: the lifted-and-hardened tier over the held-out wild set

The pre-registered rematch (`PREREGISTRATION.md`, committed at
`e365ea08` before any run artifact). It runs the same proof tier and the same
proven definition as Hunt 3, over a wider reach (the Phase 1 viability lift) with a
hardened claim-differential (Phase 2), on the funded credits the maintainer added
mid-run.

**Headline: 0 truly-proven of 7 proof-executable.** The runner flagged one
`proven-block` (outline/outline#12197), but the stop-the-line diagnosis shows it is
`proven-not-replayed` **and a false positive** of the synthesized-witness approach.
The gate does not, and must not, block on it. The genuine result of the run is a
diagnosed control gap in the claim-differential, surfaced for the first time
because the hardening made witnesses actually compile and reach the controls.

All seven entries are SECONDARY (each was diagnosed in Hunt 3, so results are
confirmatory-after-exploration). There is no primary set: Phase 4 mining is
token-gated, so no post-freeze entry was folded. This is the disclosed confirmatory
rematch, and it says so.

## The funnel, with the Phase 1 lift

| stage | Hunt 3 | Hunt 4 | change |
| --- | --- | --- | --- |
| frozen wild entries | 27 | 27 | — |
| proof-executable (Node tier can run) | 6 | **7** | +1 (outline, node-engine fix) |
| provisioned | 4 | **6** | +2 (flight-planner install fix; outline) |
| not-provisioned (real install failure) | 2 | 1 | inmanta only (paid private registry) |
| restoration proof fired, all controls green | 0 | 0 | — |
| claim-differential `claim-falsified-synthesized` (raw) | 0 | 1 | outline (false positive, see below) |
| **truly proven blocks** | **0** | **0** | — |

`hunt4-summary.json`; per-PR records under `records/`.

## Per-entry (the 7 proof-executable)

| repo#pr | maintainer category | status | claim-differential verdict | note |
| --- | --- | --- | --- | --- |
| inmanta/web-console#6972 | assertion-strip | not-provisioned | (n/a) | `@joint/plus` paid private registry; anonymous install fails. Same as Hunt 2/3. |
| lesmartiepants/poetry-bil-araby#545 | assertion-strip | ran-no-proof | `abstain:closure-unlinked` | Witness compiled and the closure regen fired (`regeneratedForClosure: true`); the witness still does not reach a revertable changed source, so the control abstains. Fail-closed. |
| myhuemungusD/SkateHubba-play#382 | error-swallow | ran-no-proof | `abstain:arbiter-disagreement` | Hunt 3 was `witness-not-compiled` here. The witness now compiles; the two arbiters did not both agree it tests the claim. Fail-closed. |
| outline/outline#12197 | mock-of-hallucination | proven-block (raw) | `claim-falsified-synthesized` | **False positive; see the receipt below.** Not counted as proven. |
| yorickdewid/flight-planner#149 | goal-not-fixed | ran-no-proof | `abstain:closure-unlinked` | Newly provisioned (the corepack-shim fix). Witness compiled; closure not linked. Fail-closed. |
| vitejs/vite-plugin-react#1246 | assertion-strip | ran-no-proof | `abstain:arbiter-disagreement` | Hunt 3 was `witness-not-compiled`. Witness now compiles; arbiters split. Fail-closed. |
| cybersemics/em#4339 | goal-not-fixed | ran-no-proof | `abstain:arbiter-disagreement` | Hunt 3 was `witness-not-compiled` (credit-cut). Witness now compiles; arbiters split. Fail-closed. |

## What the hardening changed (before / after)

| claim-differential verdict | Hunt 3 (4 provisioned) | Hunt 4 (6 provisioned) |
| --- | --- | --- |
| `witness-not-compiled` | 3 | **0** |
| `arbiter-disagreement` | 0 | 3 |
| `closure-unlinked` | 1 | 2 |
| `claim-falsified-synthesized` | 0 | 1 (false positive) |

The Phase 2 witness-emission fix worked live: **every witness now compiles** (the
structured-output contract, `witnessRetried: false` on all entries), where Hunt 3
lost three entries to `witness-not-compiled`. The engine now reaches the real
controls (arbiter gate, closure control), which fail closed correctly on five of
six. On the sixth (outline) it produced a `claim-falsified-synthesized` — and that
is where the stop-the-line diagnosis matters.

## The outline receipt (stop-the-line diagnosis)

The runner recorded outline/outline#12197 as `proven-block`
(`claim-falsified-synthesized`): arbiters agreed, closure linked, base failed
twice, head failed. Per the pre-registration and the run's hard rules, a proven
trigger is diagnosed before any number is trusted. Diagnosis
(`hunt4-diagnose-outline.ts`, output in `outline-diagnosis.md`, three re-runs on a
freshly provisioned pre/post pair):

**1. It fails the proven definition (part 3, fresh-clone replay).** The synthesized
witness `__swarm_repro__.test.js` lives in the temp workspace the harness deletes
after the run, and the witness is nondeterministic (`claude-sonnet-5`, no fixed
temperature). The published reproduce command references a file that no longer
exists and cannot be regenerated identically. This is `proven-not-replayed`, which
the pre-registration records as a harness defect and never reports as proven.

**2. The verdict is not robust.** Three re-runs on the same provisioned pair:
`witness-not-runnable` (errored) once, `claim-falsified-synthesized` twice. A real
controlled finding reproduces; this flips between "crashed" and "falsified."

**3. The witness does not discriminate base from head — it is a false positive.**
The claim is a 66-character PR title: *"fix: Suspended users should not be included
in cached member count."* The revertable changed files are `server/models/Group.ts`,
`server/models/decorators/CounterCache.ts`, and
`server/utils/__mocks__/CacheHelper.ts`. `memberCount` is a **cached** counter (the
`CounterCache` decorator, backed by CacheHelper). Every synthesized witness added
members with raw `GroupUser.create()`, which bypasses the cache-increment path, and
never set up the CacheHelper mock the real suite relies on. So `memberCount` is
never populated, and the assertion `expect(count).toEqual(1)` is false on **both
base and head** — not because suspended users are counted, but because the witness
cannot reproduce the cached-counter setup. In every "falsified" run, base and head
failed **identically**.

`claim-falsified-synthesized` is defined as "base fails AND head fails." A witness
that fails everywhere because its own setup is wrong satisfies that definition
without providing any differential signal. The controls in play (two-arbiter
agreement, closure link, base-fails-twice) establish that the witness *looks* like
it tests the claim and *fails deterministically on the base* — but **none of them
establishes that the witness would pass on a correct implementation**, i.e. that it
actually discriminates the claimed behaviour. That missing positive/discrimination
control is the root cause of this false positive.

**Conclusion:** outline#12197 is not a proven cheat. It is a `proven-not-replayed`
that, on inspection, is a false positive of the synthesized-witness approach. The
truthful proven count for Hunt 4 is **0**.

## Root cause and the discipline boundary

Two defects, both recorded, not dropped:

1. **Replayability (infrastructure).** The claim-differential witness source is not
   persisted, so no `claim-falsified-synthesized` finding can satisfy the
   fresh-clone-replay half of the proven definition. Fix: persist the witness
   source (and a fixed seed/prompt) in the record so the exact witness replays.
2. **The missing discrimination control (detection logic).** A
   `claim-falsified-synthesized` should require evidence that the witness
   *discriminates* — passes on a correct implementation, or at least produces a
   materially different outcome on base vs head — so a witness that fails
   identically everywhere abstains rather than fires.

The second fix is detection logic. Held-out discipline forbids iterating detection
logic against a wild entry, and this diagnosis already read outline. So the fix is
**not** built here from outline; it is designed from first principles and validated
on the semi-synthetic twin set (future work, disclosed). The Phase 2 twin
validation gate (`CLAIM-DIFFERENTIAL-HARDENING-REPORT.md`) measures exactly the
honest-twin false-positive rate this diagnosis flags; its result is the check on
whether this gap fires on honest inputs.

## Per-category overlap

Proven count per maintainer-labeled category over the proof-executable slice:
assertion-strip 0/3 (inmanta, poetry-bil-araby, vite-plugin-react), goal-not-fixed
0/2 (flight-planner, cybersemics/em), error-swallow 0/1 (SkateHubba),
mock-of-hallucination 0/1 (outline; the raw fire diagnosed false). No category
produced a trustworthy controlled finding.

## Spend

Claim-differential model calls only (restoration proofs make none). The Hunt 4 run:
`claude-sonnet-5` 23,609 in / 8,005 out; `claude-haiku-4-5` 9,078 in / 198 out —
**$0.14** at the sonnet-5 introductory rate ($2/$10 per MTok) plus haiku ($1/$5).
The outline diagnosis (3 re-runs) added ~$0.10. Total Hunt 4 spend ≈ **$0.24**.

## Deviations

Numbered per the run contract. Neither touches a detector, control, refuter,
threshold, or the pre-registered design.

1. **Credits topped up mid-run.** The maintainer added $20 of Anthropic credit
   after the run started. inmanta (the only entry that completed before the top-up)
   is `not-provisioned` and made no model call, so the claim-differential is funded
   consistently across every provisioned entry. The prereg's expected credit
   deviation did not materialize into a claim-differential abstain.
2. **Invalid GITHUB_TOKEN (401).** Every fetch and clone routed through
   unauthenticated public GitHub, as in Hunt 3. Fetch infrastructure only.

## Reproduce

```sh
npm run build
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt4.js --eg-wall-clock-ms 300000
# Diagnose the outline proven-block:
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt4-diagnose-outline.js 3
```

The restoration funnel is deterministic given a successful provision. The
claim-differential witness compile is nondeterministic (no fixed temperature on the
witness model), so a re-run can land a different abstain reason — or, on outline,
flip between `witness-not-runnable` and `claim-falsified-synthesized`, which is
itself the evidence that the outline fire is not a robust finding.

---

## UPDATE 2026-07-08 (soundness run): the discrimination control is landed

The disclosed future work above (the missing discrimination control) is now built
and merged. It is a four-clause conjunction (failure classification, K=3
determinism quorum, failure-identity discrimination, and pass-capability evidence)
in `src/audit/execution-grounded/discrimination-control.ts`, developed and measured
on synthetic and executable semi-synthetic twins only
(`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md`: honest-twin false positives
0/16, twin-mode recall 16/16, production reach cost 16/16 abstains).

As the single disclosed verification, the committed outline record above was
replayed through the finished control in production mode: it **abstains**, refused
at clause 4 (pass-capability), and the 1-of-3 re-run error independently trips
clause 1 (`test/audit/execution-grounded/outline-discrimination-replay.test.ts`).
`claim-falsified-synthesized` now abstains in production (no honest twin establishes
pass-capability), so the outline false positive can no longer fire. The outline
corpus entry is downgraded to `diagnosed` in the wild-cheat dataset. This note is an
append; the original record above is unchanged history.
