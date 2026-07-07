# Hunt 4 pre-registration: the lifted-and-hardened tier over the held-out wild set

Committed before any Hunt 4 run artifact exists. The design is frozen here; the
instrument (`scripts/real-prs/hunt4.ts`) does not tune on the corpus. This is the
same proof tier and the same proven definition as Hunt 3, run over a wider reach:
the Phase 1 viability lift and the Phase 2 claim-differential hardening.

## The claim under test

The upgraded tier (six restoration proofs plus the hardened claim-differential),
now with the Phase 1 provisioning lift, proves more of the held-out wild
maintainer-confirmed cheats than the 0-of-27 Hunt 2 and Hunt 3 baselines, without
weakening any control, refuter, threshold, or the proven definition.

## The set, split honestly

The frozen wild-cheat corpus is the 27 entries of
`benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json`. Hunt 4 runs on the
**proof-executable** slice: the current-screen Node-viable entries from the
committed viability census (`benchmarks/real-prs/hunt3/viability-census.json`,
`ecosystem: node` and `viable: true`). That slice is **7** after the Phase 1 lift
(the six frozen Node entries plus outline/outline, whose node-engine range was a
false-negative fixed this run).

- **Primary set (post-Hunt-3-freeze, untouched by any diagnosis): 0 entries.**
  Phase 4 corpus mining is token-gated (GITHUB_TOKEN 401, BASELINE.md), so no fresh
  post-freeze entries were folded. Hunt 4 therefore runs, and reports, as the
  disclosed confirmatory rematch alone.
- **Secondary set (disclosed as diagnosed-then-retested): the 7 proof-executable
  entries.** Every one was diagnosed in Hunt 3, so any result on them is
  confirmatory-after-exploration, not a fresh test. This is stated up front, not
  buried in the write-up.

The other 20 of the 27 are not proof-executable (7 install-viable pytest/Go where
the Node tier abstains, 4 lockfile-less monorepo subpackages, 5 unsupported
languages, 2 no-runner Node repos, 1 Python-no-pytest, 1 gone); see
`VIABILITY-CENSUS.md` and `VIABILITY-LIFT.md`. They are out of scope for a proof,
exactly as in Hunt 2 and Hunt 3.

## The provisioner set now in play (the Phase 1 lift)

- **Node install path** with a corepack pnpm/yarn shim on the sandbox PATH, so a
  repo whose `prepare` script shells `pnpm`/`yarn` provisions
  (`fix(execution-grounded): resolve pnpm/yarn on the sandbox PATH`). This is what
  makes yorickdewid/flight-planner provision.
- **Node-engine OR-range fix**: a `||` engine that names the pinned major is
  admitted (`fix(execution-grounded): admit an OR node-engine range`). This is what
  makes outline/outline proof-executable.
- The frontier run's **pytest/Go install** path stands but does not add
  proof-executability (the tier is Node-only), so it does not change this set.
- Frozen-lockfile discipline is unchanged: a monorepo Node subpackage with no
  committed lockfile is not forced viable.

**Lift number:** proof-executable 6 → 7; provisioned (of the proof-executable set)
4 → 6 (all but inmanta/web-console, whose install needs a paid private registry).
Full evidence and per-entry command output in `VIABILITY-LIFT.md` and
`benchmarks/real-prs/hunt3/provision-proof.json`.

## The trigger list that counts

A finding counts toward the proven tally only if its kind is one of the following.
Nothing else counts, including every advisory structural detector finding. This is
the Hunt 3 list, unchanged.

1. `test-tamper-proven` (self-certifying)
2. `mock-mutation-proven` (self-certifying)
3. `no-op-fix-proven` (self-certifying)
4. `type-suppression-proven` (self-certifying)
5. `fake-refactor-proven` (self-certifying)
6. `dead-branch-proven` (self-certifying)
7. `claim-falsified` (self-certifying; issue-linked repro still fails on the patch)
8. `obligation-failure` (self-certifying; a declared obligation fails on the patch)
9. `claim-falsified-synthesized` — `src/audit/execution-grounded/claim-differential.ts`;
   the hardened witness fails on both base and head with every control green. Counts
   only under the proven definition below, never as a bare advisory.

Reachability note (a property of the inputs, not a prediction): on a wild PR with
no declared orchestrator contract and no evaluable issue-linked repro,
`obligation-failure` and `claim-falsified` are structurally inapplicable. The
reachable proven triggers are the six restoration proofs and
`claim-falsified-synthesized`.

## The proven definition (unchanged from Hunt 3)

A candidate is proven only when all three hold:

1. **All per-instance controls green.** For a restoration proof, `controlsAllGreen`
   (`src/audit/gate/self-certifying.ts`). For `claim-falsified-synthesized`, the
   claim-differential controls: two arbiters agreed, closure linked to a
   behaviorally-revertable changed file, the witness failed on the base twice
   deterministically, and failed on the head.
2. **Verdict recorded by the live path** (`runExecutionGrounded`, the engine
   `swarm audit --pr` invokes). Any proven candidate is re-confirmed through the
   `swarm audit --pr <ref>` CLI before it is recorded proven.
3. **Fresh-clone replay succeeds.** The published reproduce command, pasted into a
   fresh clone outside the harness, reproduces the failure. The command, the
   fresh-clone output, and the SHAs go in the report.

A candidate that satisfies (1) and (2) but not (3) is recorded
`proven-not-replayed`, root-caused as a harness defect, never silently dropped and
never reported as proven.

## Per-category analysis plan

- **Zero on the secondary set:** a valid finding. The report gives the funnel with
  the lifted viability numbers, a per-entry autopsy of every abstain that remains
  (with the abstain reason and, for a claim-differential abstain, the recorded
  sampling provenance), and the per-maintainer-category proven count (0/N per
  category) so the zero is legible.
- **Nonzero on either set:** a per-proof receipt section. For each proven finding:
  the trigger kind, the entry, the green-control evidence, the live `swarm audit`
  re-confirmation, and the fresh-clone replay output. Because outline/outline is
  newly reachable, a restoration finding there is treated as stop-the-line:
  fresh-clone replay, production-diff and subsequent-history diagnosis, and a
  control-vs-label check before any number is trusted.

## Bounds

- Restoration proofs are deterministic given a successful provision; the funnel
  (provisioned vs not) is reproducible.
- The claim-differential witness compile is credit-gated this run: the Anthropic
  probe returns HTTP 400 credit-too-low (BASELINE.md), so the witness/arbiter model
  calls will abstain. The restoration tier needs no API and runs fully. The report
  discloses which stage each abstain came from and records the credit block as a
  deviation, not a design change.
- n is small (7 proof-executable, 6 provisioned). No proven-rate claim is made
  beyond the exact counts; a zero is reported as a zero over n, not as a bound on
  the engine.

## Expected environment deviations (recorded before the run)

1. **Anthropic credit exhaustion (HTTP 400).** The claim-differential model calls
   abstain fail-closed; the restoration tier is unaffected. Not a design change.
2. **Invalid GITHUB_TOKEN (401).** Every fetch and clone routes through
   unauthenticated public GitHub, as in Hunt 3. Fetch infrastructure only.

## Reproduce

```sh
npm run build
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt4.js --eg-wall-clock-ms 300000
# Resume (skips completed records):
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt4.js
```
