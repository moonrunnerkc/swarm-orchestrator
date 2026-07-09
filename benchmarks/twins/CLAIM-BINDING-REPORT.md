# Claim binding (Stage 2)

The production route into goal-not-fixed, with no synthesis anywhere in the
evidence chain. The claim-differential proof synthesizes a witness from the PR's
claim text and then abstains in production, because a synthesized witness's
pass-capability cannot be certified without a spec-derived oracle (the parked
research problem). Tier C sidesteps that entirely by binding the claim to an
existing repo test whose green history is a real, sound pass-capability oracle.
Both tiers ship advisory; nothing new is gate-eligible.

## Tier C: claim-to-existing-test binding

`src/audit/execution-grounded/claim-binding.ts`. When a PR's claim references
behaviour an existing repo test covers, the binder maps the claim to that test
and the engine runs it:

- **Binding is deterministic-first.** `bindClaimToExistingTest` scores candidates
  by verbatim test-name reference (+5), production-symbol overlap (+3), and
  test-name keyword overlap (+1 each), ties broken by file. An arbiter may reorder
  these candidates but never invents one, so the run spent USD 0.00 (no arbiter
  call was made; deterministic-only is the safe subset).
- **Classification reuses the discrimination control unchanged.** The engine runs
  the bound test K=3 times on base and K=3 on head and hands the runs to
  `assessDiscrimination`. Clause 4 (pass-capability), which supplies `none` for a
  synthesized witness in production and abstains, is here fed the existing test's
  **green-history run**: a real test that provably passed once is a valid oracle,
  so its identical failure on base and head means the claimed fix was not
  delivered. That verdict is `claim-falsified-bound`, a new **advisory** finding.
- **No green history => abstain.** Without a green-history checkout the engine
  supplies `none` and abstains at `no-pass-capability-evidence`, exactly as the
  synthesized route does. This is the production-honest default when no cheap
  green ref is available.

### Twin measurement (n with Wilson-95 bounds)

`benchmarks/twins/claim-binding.json`, four goal-not-fixed twins where an existing
pytest test asserts the claimed behaviour, run through the REAL engine (live
pytest, K=3, no model call, no network). Regenerate: `npm run claim-binding:measure`.

| mode | setup | expected | result |
|---|---|---|---|
| honest | base defect -> head fixed, green ref | `claim-delivered` (no finding) | 0/4 findings [0.00, 0.49] |
| cheat-bound | base defect -> head not fixed, green ref | `claim-falsified-bound` (fires) | 4/4 recall [0.51, 1.00] |
| cheat-no-green | base defect -> head not fixed, NO green ref | `abstain:no-pass-capability` | 4/4 abstain [0.51, 1.00] |

**Zero findings on honest twins** (0/4), full recall on cheat twins with a green
ref (4/4), separation **1.00**, 0 unexpected verdicts. The n is small (4 twins);
the Wilson bounds are honest about that. The no-green mode is the production reach
cost: without a green ref every cheat abstains, so the finding never fires on a
weak binding.

## Tier B: widened issue-repro extraction

`src/audit/execution-grounded/issue-repro.ts`. `classifyRepro`, which accepted
only JS/TS fenced blocks, now also extracts **Python** blocks: a `python`/`py`
block defining a `test_`/pytest/unittest case runs under `python3 -m pytest`
(the file carries a pytest-discoverable `test_swarm_repro.py` name); a Python
script runs under `python3`. Every widened format executes its own base-fail
evidence; nothing is inferred. Shell snippets stay rejected (an untrusted-shell
execution surface is not opened this run; recorded). Unit-tested in
`test/audit/execution-grounded/issue-repro.test.ts`. No new block trigger is
introduced: a widened Python repro flows through the SAME existing
`claim-falsified` self-certifying path with the SAME double-run controls, so the
block-eligibility policy is byte-identical.

## Advisory, confirmed by the policy checks

- `promotions:check`: gate-eligible detectors = 0; the new `claimBinding` policy is
  `advisory-only` (measured null), enforced by `check-policy` exactly as
  `claimDifferential` is. It can only become gate-eligible with a folded Wilson-95
  measurement clearing the floor with >= 5 true positives.
- `block-policy:check`: block-eligible = 8, unchanged. No new block trigger; Tier C
  is not in the self-certifying set.

## Spend

USD 0.00. Deterministic binding (no arbiter call), live pytest on local twins,
offline policy recompute. No judge, no model.
