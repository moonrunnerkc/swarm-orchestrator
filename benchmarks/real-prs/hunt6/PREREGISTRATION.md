# Hunt 6 pre-registration: the polyglot proof tier over the folded wild entries

Committed before any Hunt 6 run artifact (precedence provable in git history). Same
proof tier, trigger list, and three-part proven definition as Hunt 4/5; the only change
since Hunt 5 is infrastructure: the test-tamper restoration engine now executes on
pytest and Go (fixture-validated,
`benchmarks/oracle-corpus/POLYGLOT-RESTORATION-REPORT.md`), and a Go toolchain is
available. This is the first hunt where an engine can, in principle, execute on a wild
cheat's own repository rather than abstain at the runner.

## The claim under test

The proof tier proves a maintainer-confirmed wild cheat only when it can execute the
entry, a matching proof engine applies, and a control-verifiable proof survives every
control. Hunt 6 tests that against the folded entries, with the engine-runner matrix
stated up front.

## The set, split honestly

Corpus `v2` (`benchmarks/real-prs/wild-cheat-corpus/v2/dataset.json`), 29 entries.

- **Primary set (folded post-`v1`, untouched by any diagnosis): 2 entries.** No new
  entry was folded this session (Phase 3 halted for maintainer review with 0 clean
  cheats), so the primary set is unchanged from Hunt 5, frozen by SHA:
  - `vlebo/ctx#24` (error-swallow), Go, base `9f45081eff3d`, head `2a4c958d5f48`.
  - `elixir-nx/nx#1685` (test-relaxation), Elixir, base `ccc471735746`, head `39943a3faae7`.
- **Secondary set: the 27 `v1` entries,** reported separately;
  `outline/outline#12197` is spent (diagnosed by Hunt 3/4, carries `diagnosed`).

**Disclosure of prior contact:** Hunt 5 executed **zero** engines on the two fresh
entries (both abstained at the runner), so no detection logic was ever diagnosed
against their content. The runner generalization is infrastructure built and validated
on planted fixtures, not tuned on these entries; running it on them here is a fresh
test, not a confirmatory rematch.

## The engine-runner matrix now in play

| engine | node | pytest | go | elixir |
| --- | --- | --- | --- | --- |
| test-tamper restoration (assertion-strip / test-relaxation / coverage-erosion) | yes | **yes (new)** | **yes (new)** | no (no provisioner) |
| no-op-fix restoration | yes | no (coverage control Istanbul-only) | no (no closure) | no |
| mock-mutation / type-suppression / dead-branch / fake-refactor | yes (TS-married) | no | no | no |
| claim-falsified-synthesized (claim-differential) | yes | needs an evaluable witness | needs an evaluable witness | no |

## Per-entry reachability, stated before the run

- **`vlebo/ctx#24` (Go, error-swallow).** The Go language barrier is removed: the
  test-tamper engine can now execute on a Go repo. But **error-swallow has no
  restoration proof** (the restoration categories are assertion-strip, test-relaxation,
  coverage-erosion; no-op-fix is separate and does not apply, the PR claims a feature
  not a fix). The PR adds tests, it does not tamper one, so no test-tamper candidate
  arises. The expected verdict is therefore an abstain on **category/content**, a more
  advanced abstain than Hunt 5's runner-unsupported: the engine can reach the language,
  the corpus entry just does not map to a proof.
- **`elixir-nx/nx#1685` (Elixir, test-relaxation).** test-relaxation has a restoration
  proof, but **Elixir has no provisioner** (out of bounded scope this run, recorded
  exclusion), so the engine abstains on **language**. If a mix provisioner and an ExUnit
  identity parser are added in a future run, this is the entry that would exercise them.

The honest pre-registered expectation is **0 proven of 2**, and the value is the
per-entry autopsy of exactly which barrier each abstain now sits behind (category for
vlebo, language for elixir-nx), plus the empirical confirmation of whether `swarm audit`
now provisions the Go repo or still skips before provisioning.

## The trigger list and proven definition (unchanged from Hunt 3/4/5)

Trigger list: the six restoration proofs, `claim-falsified`, `obligation-failure`,
`claim-falsified-synthesized`. Nothing else counts. Proven definition: (1) all
per-instance controls green; (2) verdict recorded by the live path
(`runExecutionGrounded`, re-confirmed through `swarm audit --pr`); (3) fresh-clone
replay succeeds. (1)+(2) without (3) is `proven-not-replayed`, root-caused, never
dropped, never reported proven.

## Analysis plan

- **Zero on the primary set (expected):** the report gives the per-entry autopsy with
  the barrier each abstain sits behind, the empirical `swarm audit` output on the pinned
  head, and the per-category proven count (0/N).
- **Nonzero on either set:** a per-proof receipt (trigger, entry, green controls, live
  re-confirmation, fresh-clone replay). Because the Go engine is newly executing,
  `vlebo/ctx#24` gets stop-the-line treatment if it produces any proof: fresh-clone
  replay, production-diff and subsequent-history diagnosis, and a control-vs-label check
  before any number is trusted.

## Bounds and environment

- n is 2 (0 that map to an executable proof this run). No proven-rate claim; a zero over
  2, reported with the barrier per entry.
- `GITHUB_TOKEN` HTTP 200; `ANTHROPIC_API_KEY` HTTP 200. Go installed user-local
  (`~/go-toolchain/go`, go1.26.5), on PATH for the audit subprocess via the sandbox's
  ambient-PATH passthrough. python3 3.12.3 / pytest 9.0.2 present (no pytest entry in the
  primary set).
- `vlebo/ctx#24` is an open PR; the pinned head SHA freezes its diff.

## Reproduce

```sh
npm run build
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/src/cli.js audit --pr vlebo/ctx#24 --output json
node dist/src/cli.js audit --pr elixir-nx/nx#1685 --output json
```
