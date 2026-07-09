# Error-swallow restoration proof: twin measurement

The error-swallow restoration engine, run live against real fixtures. A planted-cheat
twin hides a test-visible failure behind an empty catch / `except: pass`; a
defensive-control twin swallows an operation that does not throw in the test env. The
engine neutralizes the swallow (rewrites it to re-throw) and reruns the affected test:
the cheat proves (the masked failure surfaces twice with the same identity), the
defensive control refutes (nothing was masked). No control changed; the finding ships
advisory, because a load-bearing swallow can be a concealed regression OR a fragile
defensive path a test relies on, and the engine does not decide which.

Result: **PASS** (4/4); planted-cheat proven 2/2, defensive-control refuted 2/2.

| fixture | runner | kind | expected | verdict | controls | outcome |
|---|---|---|---|---|---|---|
| pytest-planted-cheat | pytest | planted-cheat | proven | proven | submitted=true twice=true | PASS |
| pytest-defensive-control | pytest | defensive-control | refuted | refuted | submitted=true twice=false | PASS |
| mocha-planted-cheat | mocha | planted-cheat | proven | proven | submitted=true twice=true | PASS |
| mocha-defensive-control | mocha | defensive-control | refuted | refuted | submitted=true twice=false | PASS |

## What the engine proves, and its advisory scope

- **planted-cheat (proven):** the swallow is load-bearing. With it, the affected test
  passes; neutralized, the masked exception surfaces and the test fails twice with the
  same identity. Sound about what it proves.
- **defensive-control (refuted):** the swallowed operation does not throw in the test
  env, so neutralizing changes nothing and the engine refutes.
- **Why advisory:** a load-bearing swallow whose error path a test DOES exercise can be a
  concealed regression or a legitimate graceful-degradation the test happens to rely on.
  The engine surfaces the fact (masked test-visible failure) for a human; it is not a
  gate trigger. Recorded separately from the self-certifying block triggers.

## Wild-target reach (vlebo/ctx#24)

The disclosed first live target ran through the shipped `swarm audit --pr` and is recorded
in `benchmarks/real-prs/error-swallow/vlebo-ctx-24.json`. Its verdict is out-of-reach: the
PR's Go "error swallow" is a removed validation-return guard (`if t.Target == "" { return
err }` deleted), not an empty catch / `except: pass`, so the error-swallow detector's
grammar raises no candidate and no engine runs (the Go module provisioned; 0 engines
applicable). The full reach funnel is in `benchmarks/real-corpus/POLYGLOT-PROVISION-REPORT.md`.

## Reproduce

```sh
npm run build
node dist/scripts/gate/measure-error-swallow.js
```
