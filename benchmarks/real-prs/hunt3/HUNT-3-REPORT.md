# Hunt 3 rematch: the upgraded proof tier over the frozen wild set

The pre-registered rematch (`PREREGISTRATION.md`, committed at
`2d4cd319e3d61040dcfd91b1fea25261211ca114` before any run artifact). The claim
under test: the upgraded proof tier (six restoration proofs plus
claim-differential) proves more of the 27 held-out wild maintainer-confirmed
cheats than the 0-of-27 Hunt 2 baseline, without weakening anything.

**Result: 0 proven of 27 (0 of 6 EG-viable). No change from the baseline.** The
autopsy is the deliverable, and it is the same finding Hunt 2 reached, now with
claim-differential added to the tier: on this held-out sample the added engine
raises no controlled finding, and every abstain is fail-closed and correct.

## Before / after

| tier | proven blocks over the frozen set | source |
| --- | --- | --- |
| Hunt 2 baseline (six restoration engines) | 0 of 27 (0 of 6 EG-viable) | `benchmarks/real-prs/HUNT-2-REPORT.md`, commit `93db4e46` |
| Hunt 3 upgraded (six restorations + claim-differential) | 0 of 27 (0 of 6 EG-viable) | this run, `hunt3-summary.json` |

The six restoration engines already shipped in the Hunt 2 tier; the genuinely new
element is claim-differential (`src/audit/execution-grounded/claim-differential.ts`,
advisory `claim-falsified-synthesized`). It added **0** findings.

## The funnel

The proof tier can only execute on an EG-viable entry. 6 of the 27 are EG-viable;
the other 21 are `not-eg-viable` (no provisionable checkout) and the proof tier
structurally abstains, exactly as in Hunt 2.

| stage | count |
| --- | --- |
| frozen wild entries | 27 |
| EG-viable (proof-executable) | 6 |
| provisioned | 4 |
| failed to provision (real install failure) | 2 |
| restoration proof fired with all controls green | 0 |
| claim-differential compiled a witness | 1 |
| claim-differential reached the closure control | 1 |
| claim-differential findings (`claim-falsified-synthesized`) | 0 |
| **proven blocks** | **0** |

`hunt3-summary.json`; per-PR records under `benchmarks/real-prs/hunt3/records/`.

## Per-PR autopsy (the 6 EG-viable)

| repo#pr | maintainer category | status | claim-differential verdict | diagnosis |
| --- | --- | --- | --- | --- |
| inmanta/web-console#6972 | assertion-strip | not-provisioned | (n/a) | `corepack yarn install` failed in a clean sandbox. Real install failure, not a tool defect; no workspace to prove against. Same as Hunt 2. |
| lesmartiepants/poetry-bil-araby#545 | assertion-strip | ran-no-proof | `abstain:closure-unlinked` | Deepest the new engine reached: witness compiled, both arbiters agreed it tests the claim, the witness failed on the base twice deterministically, then the closure control found its import closure does not reach a behaviorally-revertable changed source file, so it abstained. A no-op-fix restoration was also attempted and correctly **refuted** (the diff shows a real change). Correct zero. |
| myhuemungusD/SkateHubba-play#382 | error-swallow | ran-no-proof | `abstain:witness-not-compiled` | The witness model spent its full output budget on reasoning and emitted no runnable test. Fail-closed: no witness, no proof. No structural finding in a restoration category, so no restoration attempted. |
| yorickdewid/flight-planner#149 | goal-not-fixed | not-provisioned | (n/a) | `corepack pnpm install` failed in a clean sandbox. Real install failure. Same as Hunt 2. |
| vitejs/vite-plugin-react#1246 | assertion-strip | ran-no-proof | `abstain:witness-not-compiled` | Same witness-compile abstain as SkateHubba. The structural detector flags mock-of-hallucination here, not assertion-strip, so no test-tamper restoration is applicable (matches the Hunt 2 note). |
| cybersemics/em#4339 | goal-not-fixed | ran-no-proof | `abstain:witness-not-compiled` (credit-cut; see Deviation 2) | Restoration proofs ran fully (ran-no-proof). The claim-differential witness compile was cut off by API credit exhaustion. The funded frontier run reached `abstain:closure-unlinked` here (`benchmarks/real-prs/WILD-CLAIM-DIFFERENTIAL-REPORT.md`), also a zero-finding abstain, so the proven count is unaffected. |

The 21 non-EG-viable entries are `not-eg-viable` by the static screen (no
lockfile-plus-runner the sandbox can provision); they are listed with their head
SHAs in `PREREGISTRATION.md` and are out of scope for a proof, as in Hunt 2.

## Per-category overlap against the maintainer labels

Proven count per maintainer-labeled category over the frozen set: assertion-strip
0/8, goal-not-fixed 0/7, no-op-fix 0/4, test-relaxation 0/3, error-swallow 0/2,
hardcoded-output 0/2, mock-of-hallucination 0/1. The claim-differential
specifically targets goal-not-fixed; the two goal-not-fixed EG-viable entries were
flight-planner (not-provisioned) and cybersemics/em (provisioned, abstained). No
category produced a controlled finding.

## What the zero means

This is the same conclusion Hunt 2 reached, and adding claim-differential did not
change it:

- **The restoration engines were already measured at zero here** and stay zero:
  the one restoration attempt (no-op-fix on poetry-bil-araby) refuted correctly,
  and the other provisioned entries carried no structural finding in a restoration
  category to falsify.
- **Claim-differential is fail-closed and abstained on every entry.** The one that
  reached the closure control abstained because a witness synthesized from claim
  text alone does not import the real revertable unit; the others did not compile
  a runnable witness. A `claim-falsified-synthesized` finding requires two arbiters
  to agree, the witness to fail on the base twice, the closure to link, and the
  witness to fail on the head. The corpus's small provisionable slice does not
  reach that conjunction, and the proof never fabricates a finding on an abstain.
- **The wild corpus over-represents re-specification disputes and rejected PRs**
  (20 of 27 closed-without-merge). A control-verifiable cheat needs a tampered
  test merged in a weakened state, or a claimed fix whose witness reaches the
  changed unit. This sample does not contain one the tier can execute on.

The gate stays conservative by construction: it engages off executed evidence, not
off the maintainer's accusation. That is why it produced zero false blocks while
proving zero real ones on this sample.

## Proven definition and replay

The pre-registered proven definition requires all per-instance controls green, a
verdict from the live path, and a fresh-clone replay. **Zero candidates reached
the proven bar**, so there is no proof to replay. Had one fired, the record's
reproduce command would have been re-run in a fresh clone per the BLOCK-REPORT
protocol before it counted; that path was tested but not exercised because nothing
proved.

## Protocol deviations

Numbered per the run contract. Neither touches a detector, control, refuter,
threshold, or the pre-registered design; both are environment conditions recorded
for the record.

1. **Invalid GITHUB_TOKEN (recorded in the pre-registration).** The provided token
   401s. The runner unset it and routed every fetch and clone through
   unauthenticated public GitHub access. All six EG-viable repos were reachable;
   no PR was skipped for a fetch failure. Fetch infrastructure only.
2. **Anthropic API credit exhaustion mid-run (halt handled gracefully).** A small
   residual credit balance existed at the start (enough for the earlier
   claim-differential witness compiles); it exhausted on the final entry's witness
   compile (cybersemics/em), which returned HTTP 400 "credit balance is too low".
   The restoration proofs need no API and ran fully on all four provisioned
   entries. The only effect was cybersemics/em's claim-differential abstain reason
   (`witness-not-compiled` instead of the funded run's `closure-unlinked`); both
   are zero-finding abstains, so the proven count (0) is unchanged. No control or
   threshold was touched, so this is an environment halt, not a design deviation,
   and no clean restart is required: the result is robust to it.

## Spend

Claim-differential model calls only (the structural audit and restoration proofs
make no model calls): 5 calls total. `claude-sonnet-5` (witness + arbiter A): 4
calls, 6606 input / 20030 output tokens. `claude-haiku-4-5-20251001` (arbiter B):
1 call, 2656 input / 33 output tokens. At the sonnet-5 introductory rate
($2/$10 per MTok, in effect through 2026-08-31) plus haiku ($1/$5), the run cost
**≈ $0.22**; at the standard sonnet-5 rate ($3/$15) it is ≈ $0.32. The two
not-provisioned entries and the credit-cut entry spent 0 model tokens.

## Reproduce

```sh
npm run build

# Set SWARM_EG_NODE_BIN to a Node 22 bin dir; ANTHROPIC_API_KEY for claim-differential.
# The runner unsets an invalid GITHUB_TOKEN and fetches public repos unauthenticated.
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt3.js --eg-wall-clock-ms 300000

# Resume (skips completed records):
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt3.js
```

The funnel (provisioned vs not-provisioned, restoration verdicts) is deterministic
given a successful install. The claim-differential witness compile is not
deterministic (the witness model has no fixed temperature), so a re-run can land a
different abstain reason on the same entry while the finding count stays 0.
