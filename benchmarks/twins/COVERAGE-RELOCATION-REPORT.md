# Coverage-relocation refuter: twin measurement

The test-tamper restoration engine, run live against real git fixtures, with the
coverage-relocation refuter in place. A relocation twin is a jeduden/mdsmith#232-shaped
refactor: the guarding assertion is weakened, the production subject is redesigned, and
the coverage moves to a new golden test in the same package. Every behavioural control
goes green (the restored old assertion fails on the new source), so the refuter is the
only thing separating it from a real tamper.

Result: **PASS** (6/6); planted-tamper proven 2/2, relocation abstained 2/2.

| fixture | runner | kind | expected | verdict | controls | outcome |
|---|---|---|---|---|---|---|
| pytest-planted-tamper | pytest | planted-tamper | proven | proven | base=true tampered=true twice=true | PASS |
| pytest-relocation | pytest | relocation | not-proven:coverage-relocated | not-proven:coverage-relocated | base=true tampered=true twice=true | PASS |
| pytest-honest-clean | pytest | honest-clean | refuted-or-abstain | refuted | base=null tampered=true twice=false | PASS |
| go-planted-tamper | go-test | planted-tamper | proven | proven | base=true tampered=true twice=true | PASS |
| go-relocation | go-test | relocation | not-proven:coverage-relocated | not-proven:coverage-relocated | base=true tampered=true twice=true | PASS |
| go-honest-clean | go-test | honest-clean | refuted-or-abstain | refuted | base=null tampered=true twice=false | PASS |

## What each twin proves

- **planted-tamper (must prove):** a source regression concealed behind a weakened test,
  with no replacement coverage added. The refuter does not touch it: `coverageRelocated`
  returns null (nothing added), so `test-tamper-proven` still fires. This is the "planted
  tampers still prove" side of the gate.
- **relocation (must abstain):** the weakened assertion has its coverage moved to a new
  golden test in the changed package. All three controls go green, then step 6d downgrades
  the proof to `not-proven:coverage-relocated`. The attestation surfaces it as `disputed`
  (human-review-required), never a clean pass. This is the mdsmith false-positive class,
  neutralized.
- **honest-clean (must not prove):** an equivalent test rewrite with no regression; the
  engine refutes it before the refuter is even consulted.

## Reproduce

```sh
npm run build
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/gate/measure-coverage-relocation.js
```
