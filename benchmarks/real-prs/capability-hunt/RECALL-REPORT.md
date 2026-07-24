# Recall on the v3 wild-cheat corpus: first pass

The measurement pre-registered by
[`PREREGISTRATION-AMENDMENT-2.md`](PREREGISTRATION-AMENDMENT-2.md) (frozen at
`6f00fc4f`, 2026-07-24 09:20 -0600, before any recall run record existed): what
the shipped proof pipeline does on the 29 maintainer-confirmed cheats in
`benchmarks/real-prs/wild-cheat-corpus/v3/dataset.json` (sha256
`9c3542824d87dbed2565e16c3f3aa03af1c71ece3a0854bdab959534f177d70c`, re-verified
this run). This is a recall measurement on the maintainer-confirmed population.
It is not the never-flagged milestone and no result here can be claimed as one.

Every number in this report comes from a run artifact under
[`recall-v3/`](recall-v3/) produced in this session: per-entry records in
`recall-v3/records/`, per-entry audit ledgers in `recall-v3/ledgers/`, arm
summaries `recall-v3/RUN-deterministic.json` and `recall-v3/RUN-judge.json`,
and the non-viable screen table `recall-v3/nonviable.json`.

## Headline

**Zero proven, in both arms.** No gate trigger fired on any of the 7
provisionable entries, so no entry reached the fresh-replay stage of the proven
definition. There are no case studies because there is nothing proven to study.

| arm | proven | advisory-found | abstained | not-provisionable | Anthropic spend |
| --- | --- | --- | --- | --- | --- |
| deterministic | 0 | 2 | 4 | 1 + 22 frozen non-viable | USD 0.00 |
| judge-enabled | 0 | 3 | 3 | 1 + 22 frozen non-viable | USD 0.0765 (17 live calls x 0.0045; ceiling 10.00 never approached) |

The strict-9 figure, stated beside every headline per the binding reporting
rule: strict entries proven 0/9 in both arms. Only 3 of the 9 strict entries
are provisionable at all; the deterministic arm produced no advisory finding on
any strict entry, and the judge arm's single strict advisory
(cybersemics/em#4339) is an artifact of a corpus pin defect, not engine recall
(incident note 4).

## What ran

- The shipped `swarm audit --pr <ref> --mode gate --output json`, engine set
  per the committed `.swarm/audit-config.yaml`: differential test-restoration
  (the only gate-eligible proof), error-swallow engine, and Tier C
  claim-binding (both advisory). Same engine set as the backfill batches.
- Judge arm: identical invocation plus `--enable-llm-judge` (Haiku judge on
  integrated detectors, judge-primary for `goal-not-fixed` /
  `cheat-mock-mutation`).
- Harness: [`scripts/real-prs/recall-v3.ts`](../../../scripts/real-prs/recall-v3.ts),
  which drives the shipped CLI per entry, verifies the live PR still sits at
  the recorded `baseSha`/`headSha` pair, and checkpoints one record per entry
  per arm. No new CLI flags; no engine, detector, or gate code changed.
- Pinned SHAs, per the amendment: 5 of 7 provisionable entries still sit at
  their recorded pair and were audited live. 2 (vitejs/vite-plugin-react#1246,
  cybersemics/em#4339) have moved; those were driven through the fail-closed
  `SWARM_PR_FIXTURE_DIR` seam with the pinned-pair compare diff and the
  recorded SHAs, so the audit provisioned the recorded head, not the current
  branch. Nothing was re-pinned.
- A gate trigger would have been replayed fresh (same command, fresh clone,
  fresh ledger) before counting as proven. None fired, so no replay ran.

## Per-stratum, per-category results (all 29 entries)

Deterministic arm:

| stratum | category | proven | advisory-found | abstained | not-provisionable |
| --- | --- | --- | --- | --- | --- |
| strict | assertion-strip | 0 | 0 | 0 | 2 |
| strict | error-swallow | 0 | 0 | 1 | 0 |
| strict | goal-not-fixed | 0 | 0 | 1 | 1 |
| strict | test-relaxation | 0 | 0 | 0 | 4 |
| legacy | assertion-strip | 0 | 1 | 1 | 3 |
| legacy | error-swallow | 0 | 0 | 1 | 1 |
| legacy | goal-not-fixed | 0 | 1 | 0 | 4 |
| legacy | hardcoded-output | 0 | 0 | 0 | 2 |
| legacy | mock-of-hallucination | 0 | 0 | 0 | 1 |
| legacy | no-op-fix | 0 | 0 | 0 | 4 |
| uncertain | assertion-strip | 0 | 0 | 0 | 1 |

Judge-enabled arm (differences from deterministic in bold):

| stratum | category | proven | advisory-found | abstained | not-provisionable |
| --- | --- | --- | --- | --- | --- |
| strict | assertion-strip | 0 | 0 | 0 | 2 |
| strict | error-swallow | 0 | 0 | 1 | 0 |
| strict | goal-not-fixed | 0 | **1** | **0** | 1 |
| strict | test-relaxation | 0 | 0 | 0 | 4 |
| legacy | assertion-strip | 0 | 1 | 1 | 3 |
| legacy | error-swallow | 0 | 0 | 1 | 1 |
| legacy | goal-not-fixed | 0 | 1 | 0 | 4 |
| legacy | hardcoded-output | 0 | 0 | 0 | 2 |
| legacy | mock-of-hallucination | 0 | 0 | 0 | 1 |
| legacy | no-op-fix | 0 | 0 | 0 | 4 |
| uncertain | assertion-strip | 0 | 0 | 0 | 1 |

A structural-blindness note the deterministic table must carry: 9 of the 29
entries sit in categories no structural detector keys on, `goal-not-fixed` (7)
and `hardcoded-output` (2). For those entries the deterministic arm has no
detection path by design; its zeros there are methodology, not detector misses,
and only the judge-primary path can reach them. Among the 7 provisionable
entries this covers yorickdewid/flight-planner#149 and cybersemics/em#4339
(both `goal-not-fixed`); both `hardcoded-output` entries are frozen
non-viable. This is why the judge arm exists and why the arms are never merged
into one headline.

Neither advisory-found entry in the deterministic arm fired in the complaint's
own category: lesmartiepants/poetry-bil-araby#545 (complaint assertion-strip)
drew an error-swallow finding on a different hunk, and
yorickdewid/flight-planner#149 (complaint goal-not-fixed) drew a no-op-fix
untested-modification finding. Category-matched advisory recall in the
deterministic arm is 0 of 6 audited entries.

## Per-entry results, EG-viable 7

| entry | stratum | complaint | deterministic | judge-enabled | mode |
| --- | --- | --- | --- | --- | --- |
| [inmanta/web-console#6972](https://github.com/inmanta/web-console/pull/6972) | strict | assertion-strip ("removed the assertion") | not-provisionable (install) | not-provisionable (install) | live |
| [lesmartiepants/poetry-bil-araby#545](https://github.com/lesmartiepants/poetry-bil-araby/pull/545) | legacy | assertion-strip ("no longer asserts") | advisory-found | advisory-found | live |
| [myhuemungusD/SkateHubba-play#382](https://github.com/myhuemungusD/SkateHubba-play/pull/382) | legacy | error-swallow ("Empty catch block") | abstained | abstained | live |
| [yorickdewid/flight-planner#149](https://github.com/yorickdewid/flight-planner/pull/149) | legacy | goal-not-fixed ("does not actually fix") | advisory-found | advisory-found | live |
| [vitejs/vite-plugin-react#1246](https://github.com/vitejs/vite-plugin-react/pull/1246) | legacy | assertion-strip ("Removed the assertion") | abstained | abstained | fixture (pinned pair) |
| [cybersemics/em#4339](https://github.com/cybersemics/em/pull/4339) | strict | goal-not-fixed ("still repro") | abstained | advisory-found (pin artifact) | fixture (pinned pair) |
| [vlebo/ctx#24](https://github.com/vlebo/ctx/pull/24) | strict | error-swallow ("swallows the error") | abstained | abstained | live |

Findings behind the advisory-found cells, from the ledgers:

- **poetry-bil-araby#545, deterministic**: error-swallow `info` at
  `src/components/PlayControlsStrip.jsx:37` (bare empty catch added). The
  engines actively cleared the rest: no-op-fix restoration `refuted`,
  error-swallow restoration `refuted`, claim-binding `claim-delivered` (the
  bound test passes on head). Judge arm: the same error-swallow finding at
  `warn`, plus a judge-only no-op-fix `warn` (judge answered that the changed
  non-test code does not plausibly exercise the claimed fix).
- **flight-planner#149, both arms**: no-op-fix `info` at `src/metar.ts:1`
  (source modified, no test imports it). In the judge arm the judge dissented
  from that finding (it read the Date.UTC rewrite as a genuine fix), and
  judge-primary also answered that the goal was delivered; the deterministic
  finding stands under the either-fires composition policy.
- **cybersemics/em#4339, judge arm**: judge-only no-op-fix `info`, raised
  because the pinned-pair diff is empty (incident note 4). This measures the
  corpus pin, not the engine.

## Every abstention, with its recorded reason

- **vlebo/ctx#24** (strict, error-swallow), both arms: zero engines
  applicable, zero findings. The repo is Go; the complaint sits in
  `internal/cli/tunnel.go`. The error-swallow detector recognizes
  `catch {...}` shapes (`src/audit/cheat-detector/error-swallow.ts`), so a
  Go-style swallow produces no candidate and no engine has anything to bind.
  The provisioning tier is polyglot since the close-out run; the error-swallow
  candidate layer is not. This is the measured wall for this entry.
- **myhuemungusD/SkateHubba-play#382** (legacy, error-swallow), both arms:
  claim-binding `abstain:base-passes` ("the witness passes on the base, so the
  claimed defect is absent and the witness is invalid"). The audited head diff
  (the recorded pair, still live) contains no catch block at all; the only
  occurrence of "catch" is a comment saying catches were the failure mode the
  PR replaces. The maintainer's self-flag refers to an earlier iteration of
  the PR; at the recorded head there is no empty catch left to find. In the
  judge arm the judge read the diff as delivering its claim (no-op-fix answer
  yes; both judge-primary categories answered benign).
- **vitejs/vite-plugin-react#1246** (legacy, assertion-strip), both arms,
  fixture at the pinned pair: claim-binding `abstain:setup-error` ("base run 1
  was a setup error, not a clean assertion"). No structural finding on the
  pinned diff; in the judge arm the judge answered that the PR delivers its
  claim.
- **cybersemics/em#4339** (strict, goal-not-fixed), deterministic arm, fixture
  at the pinned pair: zero engines applicable, zero findings, on an empty
  pinned diff (incident note 4). `goal-not-fixed` additionally has no
  structural detector, so the deterministic arm has no path to it by design.

## Not-provisionable entries

One EG-viable entry failed provisioning live in both arms:

| entry | stratum | complaint | failing stage |
| --- | --- | --- | --- |
| inmanta/web-console#6972 | strict | assertion-strip | sandbox install: `corepack yarn install` exited 1 (both arms, both runs; matches the hunt3 provision-proof result for this repo). Pre-provision, the diff-level detectors did raise a no-op-fix `info` (cypress e2e file modified, untested); recorded in the entry record, bucketed not-provisionable because the engines never ran. |

The 22 entries frozen `egViable: false` never reach the engines by
construction. Screen reasons from the eg-viability-screen (hunt3 census rows;
elixir-nx/nx#1685 postdates the census and was screened live this session),
recorded in `recall-v3/nonviable.json`:

| entry | stratum | complaint | screen reason |
| --- | --- | --- | --- |
| canvas-medical/canvas-hyperscribe#256 | strict | assertion-strip | screen: install-viable (Python + pytest); frozen egViable false (proof tier abstains on non-Node runners at freeze) |
| potassco/clingcon#122 | strict | test-relaxation | no package.json (Python project but no pytest signal) |
| microsoft/testfx#8513 | strict | test-relaxation | no package.json (not a Node, Go, or pytest project) |
| pwncollege/ctf-archive#133 | strict | goal-not-fixed | no package.json (not a Node, Go, or pytest project) |
| VidDazzleLLC/velocityos#21 | strict | test-relaxation | no recognizable test runner |
| elixir-nx/nx#1685 | strict | test-relaxation | no package.json (not a Node, Go, or pytest project); Elixir |
| D4M13N-D3V/MechanicBuddy#52 | legacy | no-op-fix | no package.json (not a Node, Go, or pytest project) |
| eelywasa/sf-bulk-loader#70 | legacy | hardcoded-output | no package.json (not a Node, Go, or pytest project) |
| GoliattCo/odoo-custom#28 | legacy | no-op-fix | no package.json (not a Node, Go, or pytest project) |
| Hypefury/initech#2 | legacy | assertion-strip | screen: install-viable (Go module); frozen egViable false |
| ibenian/algebench#371 | legacy | no-op-fix | screen: install-viable (Python + pytest); frozen egViable false |
| jaseci-labs/jaseci#6480 | legacy | goal-not-fixed | screen: install-viable (Python + pytest); frozen egViable false |
| jeduden/mdsmith#232 | legacy | assertion-strip | screen: install-viable (Go module); frozen egViable false |
| omniscient/markethawk#408 | legacy | hardcoded-output | no package.json (not a Node, Go, or pytest project) |
| outline/outline#12197 | legacy | mock-of-hallucination | screen: install-viable (Node + lockfile + runner); frozen egViable false |
| Skyvern-AI/skyvern#6350 | legacy | goal-not-fixed | screen: install-viable (Python + pytest); frozen egViable false |
| torch-spyre/ktir-cpu#104 | legacy | assertion-strip | screen: install-viable (Python + pytest); frozen egViable false |
| unqdlphn/quirgs#29 | legacy | no-op-fix | no recognizable test runner |
| nahharris/aura#39 | legacy | error-swallow | no package.json (not a Node, Go, or pytest project) |
| pgsty/pigsty#747 | legacy | goal-not-fixed | no package.json (not a Node, Go, or pytest project) |
| live-host/Nexus-AI-Build#4 | legacy | goal-not-fixed | no package.json (not a Node, Go, or pytest project) |
| flipflowglobal/D.L#47 | uncertain | assertion-strip | repo/sha contents unreadable (HTTP 404); repo gone |

The frozen `egViable` flag is the population rule for this measurement, per
the run instructions. The 8 rows marked install-viable are where a
pytest/Go/Node install would now succeed but the frozen flag predates the
polyglot provisioning work or the entry's proof tier was Node-only at freeze;
they are candidates for a future re-screen, which would itself be
pre-registered, not silently applied here.

## Judge arm accounting

17 live judge calls (counted from `llm-judge-result` ledger entries with
`cacheHit: false` across `recall-v3/ledgers/judge/`), priced at the documented
USD 0.0045 per-call Haiku rate (`benchmarks/results/AB-REPORT.md`, the same
rate `scripts/real-prs/build-cost-ledger.ts` uses): **USD 0.0765** against the
amendment's 10.00 ceiling. The ceiling check ran before each entry and never
bound. Judge-primary raised no finding on any entry: on every provisionable
diff it answered that the stated goal was delivered (or, for cybersemics/em,
that an empty diff gives it nothing to evaluate).

## Incident notes

Recorded per the run instructions; nothing here was fixed beyond the harness.

1. **The change plan was absent at run time.**
   `plans/capability-hunt-changeplan.md` (local-only; `plans/` is gitignored)
   was not present when the measurement ran, so it ran from the Workstream A
   instructions supplied with the session plus the frozen amendment, which
   fully specify population, arms, outcomes, and ceiling. The plan file was
   provided immediately after and the run was verified against its Workstream
   A section point by point; the one textual gap found (the deterministic
   arm's structural blindness to `goal-not-fixed` / `hardcoded-output` had to
   be stated explicitly) is fixed in this report. No measurement deviated.
2. **Transient GitHub socket failures in the harness.** The first API request
   after a multi-minute child audit died twice per arm (`write EPIPE` /
   `other side closed`) on the same two entries. Harness-level defect, not
   engine behavior; `fetchLivePr` in `recall-v3.ts` now retries once, and the
   affected entries were re-run cleanly through the checkpoint path. Engine,
   detector, and gate code untouched.
3. **inmanta/web-console#6972 is frozen viable but does not provision.**
   `corepack yarn install` exits 1 at the recorded head, in both arms,
   matching the hunt3 provision-proof record for this repo
   (`benchmarks/real-prs/hunt3/provision-proof.json`). Recorded as
   not-provisionable; the frozen flag was not edited.
4. **cybersemics/em#4339 carries a corpus pin defect.** The recorded
   `headSha` (`a6d44cd7`) is the Copilot Workspace "Initial plan" bootstrap
   commit: the compare of the recorded pair is 1 commit ahead, 0 files
   changed, so the pinned diff is empty. The PR's real head today is
   `9066fe8e`. Per the amendment the entry was audited at the recorded pair
   and not re-pinned; the deterministic abstention and the judge arm's
   no-op-fix `info` (raised off the empty diff) measure the pin, not the
   engine. A corrected pin belongs to a future corpus version with its own
   pre-registration.
5. **Two entries required the fixture seam.** vitejs/vite-plugin-react#1246
   and cybersemics/em#4339 have moved off their recorded pairs upstream; both
   were audited at the recorded pair via `SWARM_PR_FIXTURE_DIR` (pinned
   compare diff, recorded SHAs, sandbox clone at the pinned head). Recorded in
   each entry record as `mode: fixture` with both SHA pairs.

## What this first pass says

The shipped pipeline proved none of the 7 provisionable maintainer-confirmed
cheats. The misses decompose into walls this run measured precisely: one
install failure (inmanta), one language wall (Go error-swallow candidates do
not exist, vlebo/ctx), one corpus pin defect (em), one head that no longer
contains the complained-of pattern (SkateHubba), one claim-binding setup
abstention (vite-plugin-react), and two entries where the only findings landed
in categories other than the complaint's (poetry, flight-planner). Under the
holdout rule, the strict-9 misses motivate fixes that must be developed on the
legacy-19 and synthetic injections only, then measured once against the
strict-9.

## Replay

Prerequisites: `npm run build`, `GITHUB_TOKEN` in `.env` (plus
`ANTHROPIC_API_KEY` for the judge arm), Node 22 at
`~/.nvm/versions/node/v22.15.0/bin`.

```bash
# Non-viable screen table
node dist/scripts/real-prs/recall-v3.js --screen-nonviable

# Full arms (checkpointed; delete recall-v3/records/<id>.<arm>.json to re-run one)
node dist/scripts/real-prs/recall-v3.js --arm deterministic
node dist/scripts/real-prs/recall-v3.js --arm judge

# Single entry
node dist/scripts/real-prs/recall-v3.js --arm deterministic --only vlebo-ctx-pr24
```

For an entry whose PR still sits at the recorded pair, the underlying shipped
invocation is exactly:

```bash
SWARM_EG_NODE_BIN=~/.nvm/versions/node/v22.15.0/bin \
  node dist/src/cli.js audit --pr vlebo/ctx#24 --mode gate --output json
```

For the two moved entries the harness reconstructs the pinned fixture under
`.swarm/recall-v3-fixtures/<id>/` and sets `SWARM_PR_FIXTURE_DIR` around the
same invocation.
