# Patch 12.1.1: close-out

Date: 2026-07-22
Baseline: c1c394e1 (main, all gates green; see phase0-baseline.md)
Release: 303e9326, tagged v12.1.1, pushed to origin/main.

## Per-phase commits

| Phase | Commits |
|---|---|
| 0 (baseline + incident evidence) | cb0149d0 |
| 1 (builtin exemption + honest oracle case) | 1549d3f5, d67a6ede |
| Rulings 1-3 + checkpointing | 5ae79710, f27d9f3d, ea280daa |
| Canonical regeneration (rulings 4-5) | 751a361a, f0d764c0 |
| 2 (em-dash eradication + prose gate) | 8c5135ce |
| 3 (changelog record repair) | 1c3cf19f |
| 4 + 5 (README surface truth, version, badges, LOC) | f0d764c0 (README portions), 303e9326 |

## Gate battery at release (all green)

2354 passing / 45 pending, typecheck, lint, badges:check,
fp-registry:check, promotions:check (gate-eligible=0, advisory=10),
block-policy:check (block-eligible=8), corroborated-gate:check
(undefined-n), baseline:check (5 floors, oracle 303/325), prose:check,
LOC gate 49019/49019.

## Fresh-clone proof (from the GitHub remote at v12.1.1)

npm ci, build, 2354 passing; the README zero-credential quick-start
command (`git diff main...HEAD | swarm audit --diff-stdin --detectors
experimental`) exits 0 advisory-clean; 14063 re-audits at 17 blocking
(fake-refactor, assertion-strip), 14132 at 1 blocking (error-swallow);
prose:check green. 14091 audits ADVISORY-CLEAN on the local tree (the
Phase 1 gate).

## LOC delta

48897 to 49019 (+122): node-builtins.ts (+38), the builtin-mock-honest
injector (+52), and small edits in the detector, injector types,
runner, and registry. Budget file updated to the exact count.

## Numbers that moved (all mechanisms in incidents.md)

| Number | Old | New | Why | Regenerating command |
|---|---|---|---|---|
| Oracle overall recall | 301/325 (92.6%) | 303/325 (93.2%) | Two goal-not-fixed queries never held by the cache were answered under the canonical env and cached (I-6) | `npm run benchmarks:full` |
| goal-not-fixed judge recall | 0.76 (19/25) | 0.84 (21/25) | same | same |
| COVERAGE.md robust column | "no" on regen (stale "yes" committed) | "yes (robust)" for all 11 structural, judged per category at its own tested depth | loadEvasionRobust global-max-depth bug (I-2, I-8) | same |
| COVERAGE.md semantic rows | 0.68 / 0.16 | 0.84 / 0.96 | stale mixed-lineage artifact (I-4, I-8) | same |
| tail-defect head/chunk | 0/10 and 1/10 | 1/10 and 0/10 | relineage glm47 to canonical qwen (I-7) | same |
| per-hunk whole-diff flag | 2/10 | 0/10 | same (I-7) | same |
| Ground-truth floor | 301 | 303 | documented ratchet after the measured improvement | `npm run baseline:freeze` |

Updated surfaces: README badge row and Detection numbers paragraph,
docs/CLAIMS.md, benchmarks/results/AB-REPORT.md, ground-truth constants
plus frozen reference, and the sanity pins in the baseline test.

## Regenerated vs pending

Regenerated offline from committed scripts: the oracle corpus (with the
honest case), oracle-results.json, per-detector-recall.md,
judge-primary-vs-structural.md, tail-defect-recovery.md,
per-hunk-localization.md, COVERAGE.md, INDEX.md, injection-coverage.md,
ground-truth-v12.json, README badges. Double `--no-live` runs are
byte-identical (oracle-results.json differs only in its by-design
generatedAt).

Pending credentialed reruns (published snapshots that still embed
pre-2.1.0 builtin-mock findings; the numbers they feed are otherwise
unchanged, and their gate checks recompute green from committed
inputs):

- `benchmarks/real-prs/audit-results-v2/cloudflare-workers-sdk/14091.json`
  (node:child_process) and `.../prisma-prisma/29389.json`
  (node:fs/promises): re-audit with
  `node dist/scripts/real-prs/run-audit-v2.js --corpus clean --force`
  (needs the judge credentials and the frozen pre-upgrade CLI), then
  `npm run block-eligibility:full` and the benefit report if counts
  shift.
- `benchmarks/regression-corpus/audit-results/expo-expo/35036.json`
  (fs) and `.../nrwl-nx/32947.json` (fs, child_process; its
  `@nx/devkit` finding survives the exemption): same script with
  `--corpus regression --force`.

## Incident log summary (evidence/patch-12-1-1/incidents.md)

I-1 sidecar deletion (pre-existing, fixed), I-2 robust-column
irreproducibility (pre-existing, fixed), I-3 mixed judge lineage
(pre-existing, fixed via the env manifest), I-4 stale COVERAGE semantic
rows (pre-existing, regenerated), I-5 halt-report depth error
(self-caused, corrected against the committed CSV), I-6 through I-8 the
expected number movements above.

## Deferred (evidence/patch-12-1-1/DEFERRED.md)

OCR-managed blocks will reintroduce em dashes on the next `ocr init`
(file upstream; the prose gate catches it); AB-REPORT.md has no
generating script for its current-totals section.

## Quarantined

- Git over https is broken on this machine: the gh keyring token is
  invalid ("Invalid username or token"), so `git push origin main`
  fails. The release was pushed over SSH
  (`git push git@github.com:moonrunnerkc/swarm-orchestrator.git`),
  which authenticates fine. Refresh with `gh auth login -h github.com`
  or update the stored https credential.

## Handoff

1. `npm publish` for 12.1.1 (registry still serves 12.0.0). From a
   clean checkout of v12.1.1: `npm publish` (prepublishOnly builds and
   tests). Needs the npm credential.
2. `gh release create v12.1.1` with the CHANGELOG `[12.1.1]` section as
   body. Blocked locally by the invalid gh token (see Quarantined).
3. Backfill the empty v12.1.0 GitHub release body from the
   reconstructed `[12.1.1]`-adjacent `[12.1.0]` changelog section.
4. The credentialed re-audits listed under "pending" above.
5. cd.yml building the container image on the v12.1.1 tag is expected
   behavior; verify the workflow run succeeded once CI finishes.

## Environment notes

- The canonical judge model qwen3.6:35b-a3b (~19 GB) was pulled into
  the local ollama for the ruling-5 reruns; disk on / is now ~8 GB
  free.
- DECISIONS.md is intentionally gitignored (internal planning doc);
  the builtin-exemption decision entry lives in the local file and its
  public trace is the commit message of 1549d3f5 plus the changelog.
