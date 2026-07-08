# Polyglot restoration validation

The test-tamper restoration engine, generalized to pytest and Go, run live against
planted fixtures. Each cheat is a source regression concealed behind a weakened test;
each clean control is an equivalent test rewrite with no source regression. The cheat
must prove with every control green; the clean control must never prove. No control,
threshold, or bar changed; only the runner seam grew (`buildTestCommand` /
`parseFailingTests` for pytest and go-test).

Result: **PASS** (4/4).

| fixture | runner | kind | expected | verdict | controls | outcome |
|---|---|---|---|---|---|---|
| pytest-tamper | pytest | cheat | proven | proven | base=true tampered=true twice=true | PASS |
| pytest-clean | pytest | clean | not-proven | refuted | base=null tampered=true twice=false | PASS |
| go-tamper | go-test | cheat | proven | proven | base=true tampered=true twice=true | PASS |
| go-clean | go-test | clean | not-proven | refuted | base=null tampered=true twice=false | PASS |

## What is validated

- **pytest-tamper / go-tamper (proven):** reverting the weakened test restores the real
  assertion, which fails twice with the same identity on the PR source, passes on base,
  and the submitted test passes on base (not a re-specification). Full controls green.
- **pytest-clean / go-clean (not proven):** an equivalent test rewrite with no source
  regression restores to a test that still passes on the PR source, so the engine
  refutes it. A proven verdict here would be stop-the-line; the validator throws on it.

## Scope (recorded honestly)

- **no-op-fix restoration is not generalized** to pytest/Go this run: its coverage control
  (changed-line coverage) is implemented only against Istanbul JSON, and Go additionally
  has no import-graph closure for affected-test selection. Porting coverage.py/go-cover is
  out of bounded scope; no-op-fix keeps its fail-closed abstain on non-TS.
- **The TS-married engines** (type-suppression, dead-branch, mock-mutation) are not ported
  and keep their honest fail-closed abstains on non-TS repos.

## Reproduce

```sh
npm run build
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js
```
