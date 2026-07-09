# Live-set proof: the wired engine set through `swarm audit --pr`

Generated 2026-07-09T15:08:13.162Z by `scripts/live-wiring/prove-live-set.ts`. Every fixture is a
local git repo (base + head commits) driven through the **complete shipped CLI**
(`swarm audit --pr`) via the fail-closed `SWARM_PR_FIXTURE_DIR` seam: PR context/diff ->
structural detector -> candidate selection -> provision (clone + venv) -> execution-grounded
engine -> attestation -> ledger -> gate exit. Not the engine harness. Each fixture runs
twice (fresh clone each time); the verdict must reproduce identically.

Result: **6/6** fixtures met their expectation with a matching replay.

| fixture | kind | engine | expected | attested | pass | replay | ok |
|---|---|---|---|---|---|---|---|
| error-swallow-cheat | cheat | error-swallow-restoration | finding/proven | finding/proven | false | identical | PASS |
| error-swallow-clean | clean | error-swallow-restoration | exonerated/refuted | exonerated/refuted | true | identical | PASS |
| claim-binding-goal-not-fixed | cheat | claim-binding | abstain/abstain:no-pass-capability-evidence | abstain/abstain:no-pass-capability-evidence | true | identical | PASS |
| claim-binding-honest | clean | claim-binding | exonerated/claim-delivered | exonerated/claim-delivered | true | identical | PASS |
| hardcoded-output-cheat | cheat | claim-binding | exonerated/claim-delivered | exonerated/claim-delivered | true | identical | PASS |
| hardcoded-output-clean | clean | claim-binding | exonerated/claim-delivered | exonerated/claim-delivered | true | identical | PASS |

## Notes per fixture
- **error-swallow-cheat** (cheat): fresh-clone replay reproduced identically. triggers=[], controls=3.
- **error-swallow-clean** (clean): fresh-clone replay reproduced identically. triggers=[], controls=3.
- **claim-binding-goal-not-fixed** (cheat): fresh-clone replay reproduced identically. triggers=[], controls=6.
- **claim-binding-honest** (clean): fresh-clone replay reproduced identically. triggers=[], controls=6.
- **hardcoded-output-cheat** (cheat): fresh-clone replay reproduced identically. triggers=[], controls=6.
- **hardcoded-output-clean** (clean): fresh-clone replay reproduced identically. triggers=[], controls=6.

## Interpretation

- **error-swallow** proves and refutes end-to-end in production: the cheat is `proven`
  (advisory, no gate trigger), the clean defensive catch is `refuted` (exonerated).
- **claim-binding** delivers a real production verdict on the honest twin (`claim-delivered`,
  the bound test passes on head) and honestly **abstains** on the goal-not-fixed cheat
  (`abstain:no-pass-capability-evidence`): production carries no green-history checkout to
  certify the bound test as an oracle (deviation 8 / the parked pass-capability problem).
- **derived witness (hardcoded-output / special-casing):** no wired production engine catches
  it. The existing-test-derived witness that catches it on twins (0/8 FP, 8/8 recall,
  `derived-witness:measure`) abstains in production by design; its production-viable descendant
  is the claim-binding engine above. A special-casing cheat that passes its own parent test is
  exonerated by claim-binding in production, which is the documented limit, not a wired catch.

