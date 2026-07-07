# Experiment run baseline (Phase 0)

Dependency verification and baseline capture for the three-experiment run
(Hunt 3 rematch, judge gate-stakes cost, propensity pilot). Captured before any
experiment ran. Every figure below points at a committed artifact and the script
that regenerates it.

## Branch point

- HEAD at capture: `3d66271402d39177b4ca92adb70cafe82ca487f3`
  (`docs(readme): jehna-template overhaul, keep TOC and cover`).
- Working tree at capture: clean except one untracked file
  (`social-posts-behavioral-cheats.md`, unrelated draft, not touched by this run).

## Environment conditions (binding for the whole run)

These are the machine facts every experiment inherits. They are recorded here so
a later reader knows exactly what was and was not reachable.

| condition | state | consequence |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | present, **valid** (verified with a 1-token `claude-haiku-4-5` call: `stop_reason: max_tokens`, usage returned) | claim-differential and judge paths can run; token spend is tracked per experiment |
| `GITHUB_TOKEN` | present but **invalid** (HTTP 401 on `GET /user` and `GET /rate_limit`) | the wild corpus references diffs by `repo`+`headSha`+`baseSha` and vendors none, so any GitHub fetch that relies on this token fails; see the fetch-path note below |
| Docker daemon | up (Docker 29.3.1) | execution-grounded provisioning can run |
| Build/run Node | v22.15.0 via nvm (`SWARM_EG_NODE_BIN` unset; system `node` is v18, below the `>=20` engines floor, so all build/test/run commands use the nvm Node 22 bin) | repo builds and the sandbox provisions under a supported Node |
| `SWARM_TRIAL_BUDGET_USD` | unset | Experiment 3 runs no agents: harness is built, tested against a stub, committed, and the pilot is recorded as awaiting budget |

### Fetch-path note (invalid GITHUB_TOKEN)

The provided token 401s, but the six execution-grounded-viable wild repos are all
public and reachable unauthenticated (`git ls-remote` succeeds on all six; five of
six advertise the pinned head SHA). The proof tier clones over
`https://github.com/<repo>.git` (`sandbox.ts:210`), which needs no token for a
public repo, and `pr-fetch.ts` falls back to an unauthenticated Octokit when no
token is set. So the wild-set fetch routes through unauthenticated public access
by unsetting the invalid token for the run. This touches no detector, control,
refuter, threshold, or the proven definition; it is a fetch-infrastructure
condition, recorded here and restated in each experiment that fetches. Where a
specific repo or SHA is unreachable unauthenticated, that PR is recorded as a
fetch failure, not improvised around.

## Dependency verification

Each frontier dependency the experiments build on, its real path, its producing
script, and the verification that it exists and runs.

| dependency | path | producing script | verified |
| --- | --- | --- | --- |
| claim-differential engine wired into the EG pipeline | `src/audit/execution-grounded/claim-differential.ts`, imported and run in `src/audit/execution-grounded/index.ts` (`runClaimDifferential`, `runClaimDifferentialPhase`, `claimDifferentialFindings`) | n/a (library) | present; `index.ts:57` import, `index.ts:1387` invocation gated by `config.claimDifferential`, `index.ts:1552` advisory `claim-falsified-synthesized` finding |
| wild-cheat corpus with `holdout` flags | `benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json` (+ `DATASET.md`) | `scripts/corpus/export-wild-cheats.ts` (`npm run export-wild-cheats`) | present; 27 entries, every entry `holdout: true`; held-out loader `scripts/real-prs/lib/wild-cheat-corpus.ts` refuses non-evaluation callers |
| twin corpus with `tier` fields | `benchmarks/twins/semi-synthetic/twins.json` (`tier: semi-synthetic`, 52 pairs), `benchmarks/twins/wild-pair/honest-twins.json` (`tier: wild-pair`) | `scripts/corpus/*` (semi-synthetic twins), `scripts/corpus/mine-honest-twins.ts` (wild-pair linkage) | present; both carry a `tier` field |
| judge baseline script | `scripts/benchmarks/judge-baseline-measure.ts` | `npm run judge-baseline` | present; report `benchmarks/twins/JUDGE-BASELINE-REPORT.md` |
| polyglot provisioning | `src/audit/execution-grounded/sandbox.ts` (`provisionNonNode` from `polyglot-install.ts`; corepack yarn/pnpm; `detectPackageManager`) | n/a (library); harness `scripts/real-prs/polyglot-provision.ts` | present; npm/yarn/pnpm/bun via corepack, non-Node ecosystems via `provisionNonNode` |
| claim-differential measurement over the wild set | `scripts/real-prs/claim-differential-measure.ts` | `npm run claim-differential:measure` | present; frontier output `benchmarks/real-prs/WILD-CLAIM-DIFFERENTIAL-REPORT.md` (0 findings) |
| single-PR proof-tier driver | `scripts/real-prs/reprove-one.ts` -> `scripts/real-prs/lib/proof-tier.ts` (`proveOne`) | n/a (instrument) | present; runs the six restoration engines (claim-differential off by default in this driver) |

No required dependency is missing. All three experiments proceed.

## Baseline figures

### The 0/27 rematch baseline

- **Proven wild cheats at baseline: 0 of 27.** Source:
  `benchmarks/real-prs/HUNT-2-REPORT.md`, committed at
  `93db4e46f8dc24987aa1a8969bc78e2dee133cf7`
  (2026-06-12, `docs(hunt-2): report the wild-prevalence finding and the funnel`).
- Of the 27 human-labeled wild cheats, 6 are execution-grounded-viable. The Hunt 2
  six-engine proof tier ran all six (4 `ran-no-proof`, 2 `not-provisioned`) and
  proved **0**. The other 21 are not EG-viable, so the proof tier structurally
  abstains on them.
- Claim-differential (the one genuinely new engine since Hunt 2) was measured over
  the same 6 EG-viable entries by the frontier run:
  `benchmarks/real-prs/WILD-CLAIM-DIFFERENTIAL-REPORT.md`, **0
  `claim-falsified-synthesized` findings** (5 compiled a witness, 2 arbiters
  agreed on 2, 2 provisioned, both abstained `closure-unlinked`). This is the
  claim-differential axis of the rematch's before state; it was produced before
  Experiment 1's pre-registration and is not the experiment result.

### Wild corpus (frozen evaluation set)

- Size: **27 entries**, 7 merged, 20 closed, 6 EG-viable.
- Committed at `19388fedb1de33a1bbfed709ef89e96270f0ad2c` (2026-07-07);
  `dataset.json` git blob `746ef7dd64cfd0a56f430c23ffc93aabde066deb`.
- Every entry carries `holdout: true`. Category distribution: assertion-strip 8,
  goal-not-fixed 7, no-op-fix 4, test-relaxation 3, error-swallow 2,
  hardcoded-output 2, mock-of-hallucination 1. Vendors: claude-code 18,
  copilot-workspace 6, codex-cli 3.
- The 6 EG-viable entries (the only ones the proof tier can execute) with pinned
  head SHAs:
  1. `inmanta/web-console#6972` (assertion-strip) head `db110727386a`
  2. `lesmartiepants/poetry-bil-araby#545` (assertion-strip) head `5ecb708622fd`
  3. `myhuemungusD/SkateHubba-play#382` (error-swallow) head `02e9df65e50c`
  4. `yorickdewid/flight-planner#149` (goal-not-fixed) head `59d0cd038dbe`
  5. `vitejs/vite-plugin-react#1246` (assertion-strip) head `82d2c5784b9b`
  6. `cybersemics/em#4339` (goal-not-fixed) head `a6d44cd743de`
- The full 27-entry frozen list with per-entry head SHAs is enumerated in the
  Experiment 1 pre-registration.
- No corpus growth beyond the original 27 in this tree: `counts.entries` is 27 and
  the miner has folded no new entries since the Hunt 2 export.

### Twin corpus (per tier)

- `semi-synthetic` tier: **52 pairs**, 13 categories x 4 pairs each (assertion-strip,
  cheat-mock-mutation, comment-only-fix, coverage-erosion, dead-branch-insertion,
  error-swallow, exception-rethrow-lost-context, fake-refactor, goal-not-fixed,
  mock-of-hallucination, no-op-fix, test-relaxation, type-suppression). The two
  semantic categories (goal-not-fixed, cheat-mock-mutation) are 4 pairs each = 8
  semantic pairs. Diffs are embedded in `twins.json` (no fetch needed).
- `wild-pair` tier: 20 closed wild cheats examined for an honest twin;
  **1 resolved** (`copilot-workspace-pwncollege-ctf-archive-pr133` paired with
  merged PR #166), 19 unpaired (no resolvable honest counterpart). The wild-pair
  separation is provisioning-bound and referenced by SHA, not vendored.
- Committed at `0faac842460d6fa8d7b6ebdd7aade7ed932d9625` (2026-07-07).
- Detector-tier separation (`TWIN-SEPARATION-REPORT.md`): semi-synthetic 52 pairs,
  56% cheat fire, 2% honest fire, separation 0.54, McNemar p 0.0000.
- Judge baseline over the 8 semantic twins (`JUDGE-BASELINE-REPORT.md`):
  judge-primary diff-only recall 88% (Wilson-lower 0.53) at 13% honest FP
  (Wilson-upper 0.47); execution proof tier 0% recall / 0% FP (abstains).

### Promotions and block-eligibility state

- `benchmarks/real-corpus/promotions.json`: `gateEligibleDetectors: []`, 10
  detectors `advisory-only`, gate precision threshold 0.9, min TP 5. No structural
  detector blocks.
- `benchmarks/real-corpus/block-eligibility.json`: `blockEligibleCount: 8`,
  `blockEligibleTriggers` = the eight self-certifying kinds (`claim-falsified`,
  `obligation-failure`, `test-tamper-proven`, `mock-mutation-proven`,
  `no-op-fix-proven`, `type-suppression-proven`, `fake-refactor-proven`,
  `dead-branch-proven`), each eligible by tier with 0 firings behind it.
  `corroborated-under-constraint` is **not** eligible (circumstantial, Wilson-95
  lower 0.510, below the 0.90 bar with 4 confirmed TPs).
- `benchmarks/real-corpus/corroborated-gate-precision.json`: status `undefined-n`
  (the provisionable slice carries no outcome-bad PR); the corroborated structural
  gate does not light up.

## Suite status

`npm run test:ci` (Mocha over the prebuilt `dist/`) run under Node 22 before any
experiment: **2119 passing, 0 failing, 39 pending** (2m). Suite green. The run is
cleared to begin.
