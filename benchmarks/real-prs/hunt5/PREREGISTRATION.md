# Hunt 5 pre-registration: the proof tier over the freshly folded wild entries

Committed before any Hunt 5 run artifact exists. The design is frozen here; the
instrument does not tune on the corpus. Same proof tier, trigger list, and proven
definition as Hunt 4, run over the entries folded into corpus `v2` this session, the
first fresh (post-`v1`-freeze) primary set this tool has had.

## The claim under test

The proof tier proves a maintainer-confirmed wild cheat only when it can execute the
entry and a control-verifiable proof survives every control. Hunt 5 tests that claim
against the two freshly folded entries, honestly, with their language and viability
stated up front.

## The set, split honestly

Corpus `v2` (`benchmarks/real-prs/wild-cheat-corpus/v2/dataset.json`) is the `v1`
27 plus 2 maintainer-approved entries folded this session.

- **Primary set (freshly folded, post-`v1`-freeze, untouched by any diagnosis): 2
  entries.** Frozen by SHA here:
  - `vlebo/ctx#24` (error-swallow), state open, base `9f45081eff3d`, head `2a4c958d5f48`.
    Ecosystem Go, `egViable: true` (Go module).
  - `elixir-nx/nx#1685` (test-relaxation), state merged, base `ccc471735746`, head
    `39943a3faae7`. Ecosystem Elixir, `egViable: false`.
- **Secondary set (disclosed as diagnosed-then-retested): the 27 `v1` entries.** Any
  result on them is confirmatory-after-exploration, not a fresh test.
  `outline/outline#12197` is itemized as **spent** (diagnosed by Hunt 3 and Hunt 4's
  outline diagnosis; carries `diagnosed` in the dataset) and is reported separately
  from any fresh count.

## Proof-executability of the primary set, stated before the run

The restoration proof tier is **Node-only** (Hunt 4 pre-registration: the pytest/Go
install path stands but does not add proof-executability). Therefore:

- `vlebo/ctx#24` is a **Go** repo. It is `egViable` for provisioning, but the
  Node-only restoration tier cannot execute it. Reachable proven trigger: only
  `claim-falsified-synthesized`.
- `elixir-nx/nx#1685` is an **Elixir** repo, not viable for any current provisioner.
  No restoration proof and no execution-grounded witness is executable.

So the proof-executable-by-the-restoration-tier count over the primary set is **0 of
2**. This is a property of the fresh entries' languages, recorded before the run, not
a prediction dressed as a result. The honest expectation is a zero on the primary
set; the value of the run is the per-entry autopsy of *why*, which is the gap between
the wild cheats maintainers catch (any language) and what a Node-only proof tier can
execute.

## The trigger list that counts (unchanged from Hunt 3/4)

A finding counts toward the proven tally only if its kind is one of: `test-tamper-proven`,
`mock-mutation-proven`, `no-op-fix-proven`, `type-suppression-proven`,
`fake-refactor-proven`, `dead-branch-proven` (the six restoration proofs, self-certifying);
`claim-falsified` (issue-linked repro still fails on the patch); `obligation-failure`
(a declared obligation fails); `claim-falsified-synthesized` (the hardened claim-
differential witness fails on base and head with every control green). Nothing else
counts, including every advisory structural detector finding and the advisory
derived-witness class (endgame run; abstains in production).

Reachability note: on a wild PR with no declared orchestrator contract and no
evaluable issue-linked repro, `obligation-failure` and `claim-falsified` are
structurally inapplicable. For the primary set the only reachable trigger is
`claim-falsified-synthesized`, and only on the Go entry's provisioned tree.

## The proven definition (unchanged from Hunt 3/4)

A candidate is proven only when all three hold: (1) all per-instance controls green;
(2) the verdict is recorded by the live path (`runExecutionGrounded`, re-confirmed
through `swarm audit --pr <ref>`); (3) fresh-clone replay of the published reproduce
command succeeds. A candidate satisfying (1) and (2) but not (3) is
`proven-not-replayed`, root-caused as a harness defect, never dropped, never reported
as proven.

## Per-category analysis plan

- **Zero on the primary set (the expected outcome):** a valid finding. The report
  gives the per-entry autopsy: for each, the ecosystem, the reason the restoration
  tier is inapplicable (non-Node), and the reason the claim-differential abstains (no
  evaluable issue-linked repro; the synthesized witness is the discrimination-control
  case the soundness run recorded as unsound in production). The per-maintainer-
  category proven count is 0/N per category so the zero is legible.
- **Nonzero on either set:** a per-proof receipt (trigger kind, entry, green-control
  evidence, live `swarm audit` re-confirmation, fresh-clone replay output). Any
  restoration finding on a newly reachable entry is stop-the-line: fresh-clone replay,
  production-diff and subsequent-history diagnosis, and a control-vs-label check before
  any number is trusted.

## Bounds

- n is tiny (2 primary; 0 proof-executable by the restoration tier). No proven-rate
  claim is made; a zero is reported as a zero over 2, not as a bound on the engine.
- `elixir-nx/nx#1685`'s tolerance loosening was partially reverted during review, so
  its `base..head` diff may not contain the cheat at head; a restoration or witness
  abstain there is correct, not a miss. Recorded as a caveat, not a design change.
- `vlebo/ctx#24` is an open PR; the head SHA pins the diff, so the entry is stable
  even if the PR later changes.

## Environment (recorded before the run)

`GITHUB_TOKEN` HTTP 200 and `ANTHROPIC_API_KEY` HTTP 200 (baseline). Unlike Hunt 4,
the model path is not credit-gated, so a claim-differential witness can compile if one
is reachable; it still abstains without an evaluable witness. Fetch and clone use the
authenticated path.

## Reproduce

```sh
npm run build
# Live per-entry verdict (the path swarm audit --pr invokes), recorded per entry:
node dist/src/cli.js audit --pr vlebo/ctx#24 --output json
node dist/src/cli.js audit --pr elixir-nx/nx#1685 --output json
```
