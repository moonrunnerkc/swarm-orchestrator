# Frontier run: evidence report

The end-to-end record of the five-phase frontier run. Every number below traces to
a committed artifact or a captured run; every artifact regenerates from a committed
script. Numbers are reported per tier (synthetic, semi-synthetic, wild) and never
blended. Nothing new gates: the advisory tier and the zero-false-positive block
posture are unchanged, verified in the closing gate state.

Base commit: `56cf3994`. Working branch: `frontier/polyglot-claim-diff-twins`.
Node: `v22.15.0` via nvm (the machine default `node` is v18, which the engines
reject; it is not used). Both APIs were live this run: GitHub (5000/5000) and
Anthropic (200 with credits), so the phases that need live LLM/GitHub ran rather
than halting. The `.env` `GITHUB_TOKEN` was stale ("Bad credentials"); the valid
token from the `gh` keyring was used for the live GitHub runs.

## Commit map

| phase | commit | subject |
|---|---|---|
| 0 | `e317cdc7` | freeze Phase 0 baseline |
| 1 | `3f880fb0` | install pytest and Go deps in the sandbox |
| 2 | `19388fed` | wild-cheat dataset export, hold-out guard, and complaint mining |
| 3 | `7e1612e3` | claim-differential proof family (advisory-only) |
| 3 | `9d92395a` | measure claim-differential over the wild corpus |
| 5 | `62b33e7e` | source the version and oracle badges so they cannot lag |
| 4 | `0c93685c` | semi-synthetic twin corpus and paired separation |
| 5 | `0faac842` | judge baseline vs the proof tier, and changelog |

## Closing gate state (nothing new gates)

- `npm run promotions:check`: gate-eligible=0, advisory=10 (unchanged).
- `npm run block-policy:check`: block-eligible=8 (unchanged).
- `npm run corroborated-gate:check`: status `undefined-n`, n_bad=0, tp=0/0 (unchanged).
- `node dist/scripts/badges/regen-badges.js --check`: badges up to date.
- Full suite green at every phase commit (final: 2119 passing, 39 pending).

## Phase 0: baseline freeze (`e317cdc7`)

Recorded in [`BASELINE.md`](BASELINE.md). Suite, typecheck, promotions, block-policy,
corroborated-gate all green on the branch point. Starting numbers: EG-viable 78/197
(Node 12, Python 52, Go 14), corroborated-gate undefined-n, gate-precision n=0,
Hunt 2 overlap 5/27 exact and 13/27 any, advisory union precision 0.217, outcome
distribution 0 reverted / 22 hotfixed / 175 survived.

## Phase 1: pytest and Go provisioning (`3f880fb0`)

**Capability landed.** `src/audit/execution-grounded/polyglot-install.ts` adds the
Python install (isolated `.venv` + pip for a pinned `requirements.txt` and/or the
project, or `poetry install` on a `poetry.lock`) and the Go install
(`go mod download`, checksum-frozen). `provisionWorkspace` routes by ecosystem; the
build step and the proof tier stay Node-only. Tests:
`test/audit/execution-grounded/polyglot-install.test.ts` (10 cases, incl. a real
offline venv install) and the restoration proofs' explicit pytest/go-test
fail-closed cases in `test-restoration.live.test.ts`.

**Measured result.** `npm run polyglot-provision`
([`benchmarks/real-corpus/polyglot-provisioning.json`](../../benchmarks/real-corpus/polyglot-provisioning.json))
attempted all 8 outcome-bad EG-viable PRs. Per-PR outcome:

| status | count | detail |
|---|---|---|
| `no-mutable-source` | 7 | purely additive PRs (new file + test); the v12 additive-code control finds nothing to revert |
| `provision-failed` | 1 | `openhands…pr14505` cloned, then `poetry install` failed (poetry not on PATH); the real command is recorded |

The 8 break down as 5 pytest (OpenHands) + 3 Go (divord97/ccc), correcting the
"eight pytest" figure in the earlier report. **Honest finding:** the Node-only
install path was never the binding constraint. The binding constraint is the
Node-only corroboration engine (mutation/coverage/issue-repro) plus the additive
shape of these PRs, so the corroborated gate stays `undefined-n`. `provisionableCount`
stays 12 (corroboration-scoreable = Node). Reports corrected:
`CORROBORATED-GATE-READINESS.md`, `EG-VIABILITY-POLYGLOT-REPORT.md`,
`docs/limitations.md`. `corroborated-gate:check` and `promotions:check` re-run and
unchanged.

## Phase 2: wild cheat corpus at scale (`19388fed`)

**Dataset.** `npm run export-wild-cheats`
([`benchmarks/real-prs/wild-cheat-corpus/v1/`](../../benchmarks/real-prs/wild-cheat-corpus/v1))
built 27 entries from the committed Hunt 2 population: 7 merged, 20 closed, 6
EG-viable. Category tally (primary): assertion-strip 8, goal-not-fixed 7, no-op-fix
4, test-relaxation 3, error-swallow 2, hardcoded-output 2, mock-of-hallucination 1
(matches the Hunt 2 catalog table). Diffs are referenced by repo + SHA, not
vendored. `DATASET.md` covers provenance, the selection bias (only cheats humans
caught), and a cross-taxonomy mapping.

**Hold-out enforcement in code.** `loadWildCheatCorpus` throws `HeldOutCorpusError`
for any non-evaluation caller; pinned by `test/real-prs/wild-cheat-corpus.test.ts`.

**Continuous growth.** `.github/workflows/complaint-mine.yml` +
`scripts/real-prs/mine-complaints.ts` (scheduled, budgeted, checkpointed,
dual-arbiter category confirmation; uploads candidates for maintainer review, never
folds). One bounded live run: **66 PRs examined, 63 not agent-attributed, 3 agent
PRs whose complaint did not reconfirm in the conversation, 0 verified candidates**
(after the search abuse-limit cooled). Agent attribution is the dominant filter.
The mined-candidates file is a run artifact (gitignored), not committed.

**Deviation recorded:** the dual-arbiter shipped default is `ollama` + `anthropic`;
this GPU-less machine has no local model, so the arbiter ran two Anthropic tiers
(sonnet-5 + haiku-4-5). The TRACE 54-category taxonomy the plan names could not be
resolved to a canonical source (searched 2026-07; nearest analogues MAST-14, TRAIL,
the 20,574-session misalignment study), so `DATASET.md`'s cross-taxonomy column is
labeled provisional rather than fabricated.

## Phase 3: claim-differential proof family (`7e1612e3`, `9d92395a`)

**Engine.** `claim-witness.ts` (compiler + two-model arbiter gate + controls, LLM
injected for tests), `claim-differential.ts` (pure verdict table + orchestration,
short-circuits the head run), `claim-llm.ts` (Anthropic provider). Wired into
`index.ts` as a sibling to issue-repro, opt-in via
`.swarm/audit-config.yaml (executionGrounded.claimDifferential)`, `--pr` only.
Verdicts: base-fails+head-passes → claim-delivered; base-fails+head-fails →
`claim-falsified-synthesized` (the one finding); base-passes / any control not
green → abstain. Fail-closed throughout.

**Advisory-only, pinned.** `promotions.json` carries a `claimDifferential` policy
that is gate-eligible only with a measured Wilson-95 lower ≥ 0.90 and ≥ 5 true
positives; `check-policy.ts` fails on any hand-flip. It never touches
`block-eligibility.json`.

**Tests.** 21 unit cases (verdict table confirm/refute/abstain, compiler, closure
control, config knob, finding mapper, promotion policy) plus a live `node --test`
e2e proving claim-delivered / claim-falsified-synthesized / abstain:base-passes end
to end (`claim-differential-e2e.test.ts`).

**Measured over the held-out wild corpus.** `npm run claim-differential:measure`
([`WILD-CLAIM-DIFFERENTIAL-REPORT.md`](../../benchmarks/real-prs/WILD-CLAIM-DIFFERENTIAL-REPORT.md)),
loaded through the hold-out choke point. Funnel over the 6 EG-viable entries: **5
witnesses compiled → 2 passed the two-model arbiter gate → 2 provisioned
(SkateHubba, cybersemics/em) → both closure-unlinked → 0 findings, 0 delivered.**
Zero fabricated findings; fail-closed at every stage. A witness compiled from claim
text alone rarely reaches the real changed code, so it abstains at the closure
control rather than inventing a finding.

**Two harness bugs root-caused in the live run** (fixed in source, not worked
around): the witness completer sent `temperature: 0` which the current models
reject; and at `max_tokens: 1500` the model spent the whole budget on a thinking
block and returned no text (every witness failed to compile), fixed by raising to
8000.

## Phase 4: twin corpus and paired separation (`0c93685c`)

**Semi-synthetic tier.** `npm run twins:build` injects the oracle defects into
presumed-clean survived PRs: 52 pairs across 13 categories (cheat twin = injected,
honest twin = untouched clean, shared source PR). `npm run twins:separation`
([`TWIN-SEPARATION-REPORT.md`](../../benchmarks/twins/TWIN-SEPARATION-REPORT.md))
scores the advisory detector tier (diff-only, deterministic) with an exact McNemar
test (`src/audit/gate/mcnemar.ts`, 6 tests):

| metric | value |
|---|---|
| pairs (semi-synthetic) | 52 |
| cheat fire rate | 56% |
| honest fire rate | 2% |
| paired separation | 0.54 |
| McNemar exact p | 7.4e-9 |
| cheat Wilson-95 lower | 0.42 |
| honest-twin false positives | 1 (coverage-erosion) |

Seven structural categories separate near-totally (cheat ~100%, honest 0%). The one
honest-twin fire is a recorded **advisory** false positive (the detector tier is
advisory, precision ~0.22), **not** the block-tier stop-the-line, which applies only
to a proven trigger; this measurement runs no proof, so it is not a halt condition.

**Wild-pair tier.** `npm run twins:honest-mine`
([`benchmarks/twins/wild-pair/honest-twins.json`](../../benchmarks/twins/wild-pair/honest-twins.json))
links closed wild cheats to their landed fixes: **1 resolved of 20** (ctf-archive#133
↔ #166, issue #128), 19 unpaired (most rejected cheats never got a tracked fix).

## Phase 5: judge baseline and housekeeping (`62b33e7e`, `0faac842`)

**Judge baseline.** `npm run judge-baseline`
([`JUDGE-BASELINE-REPORT.md`](../../benchmarks/twins/JUDGE-BASELINE-REPORT.md)) runs
the shipped judge-primary diff-only path over the 8 semantic twins:

| tier | recall on cheat twins | false positives on honest twins |
|---|---|---|
| judge-primary (diff-only) | 88% (7/8) | 13% (1/8) |
| execution proof tier | 0% (abstains) | 0% |

The judge is the reachable recall from the diff alone; the proof tier trades that
recall for zero false positives. Complementary, both advisory. Run against
`claude-haiku-4-5` (the pinned Haiku judge accepts `temperature: 0`; verified).

**README badge lag fixed (`62b33e7e`).** Root cause: the badge row is generated but
nothing enforced freshness, so 12.1.0 shipped with a 12.0.0 badge, and the oracle
badge read a volatile A/B report (drifted to 253/300) instead of the CI-guarded
baseline (301/325). Fixed the generator to source the oracle badge from the frozen
baseline, regenerated via the generator (version 12.0.0 → 12.1.0, oracle unchanged
at 301/325), and wired `badges:regen --check` into CI so a stale row fails the build.

**CHANGELOG.** A `[Unreleased] - 12.2.0` entry (Keep a Changelog) covers the cycle.
Release notes prepared; not tagged or published, and `package.json` version is
unchanged.

## Scope cuts (recorded)

- **Leaderboard fold (Phase 5).** Folding the proof-vs-judge comparison into the
  leaderboard requires modifying `benchmarks/leaderboard/score.ts` and re-running
  the full synthetic-corpus scorer (500+ replays), which regenerates snapshot files.
  The comparison data is already committed and regenerable
  (`twin-separation.json`, `judge-baseline.json`, `wild-claim-differential.json`);
  the mechanical data-plumbing into the leaderboard renderer is deferred to avoid a
  full leaderboard-snapshot regeneration in this cycle.
- **Hardcoded-output sub-mode (Phase 3).** The primary claim-differential engine is
  delivered and measured; the hardcoded-output perturbation sub-mode (perturb an
  input in an arbiter-agreed equivalence class) is deferred as a documented
  follow-on to keep the cycle within budget. The infrastructure (verdict table,
  controls, arbiter gate) is reusable for it.
- **Execution proof-tier / claim-differential twin separation (Phase 4).** The
  detector-tier separation is measured (above); the execution proof-tier and
  claim-differential separation over the same pairs is bounded by the same 12-Node
  provisioning limit the Phase 1 finding documents, and is recorded as follow-on.
- **Wild-corpus judge run (Phase 5).** The judge baseline is measured on the
  committed semantic twins; the wild-corpus judge run needs the wild diffs, which the
  dataset references rather than vendors (fetch-bound follow-on).

## Halts

No phase halted. All APIs were live. Environment constraints handled and recorded
in place: no GPU (no local arbiter/judge model, so Anthropic tiers stood in for the
second family, recorded in the model ids); the stale `.env` GitHub token (used the
`gh` keyring token). No proven trigger fired on an outcome-clean PR or an honest
twin, so the stop-the-line protocol was not invoked.
