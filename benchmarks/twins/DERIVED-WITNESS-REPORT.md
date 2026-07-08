# Derived-witness measurement: the bounded pass-capability path

Phase 3 of the endgame run. The claim-differential proof normally synthesizes its
witness from claim text, whose pass-capability no production proxy can certify
(`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md`). This report measures a
different witness class: one DERIVED by perturbing a test that already passes on
head. The parent test's green run is direct evidence the witness harness, imports,
and setup work, which is exactly the blind spot the outline false positive
exploited (a witness that could never pass anywhere for its own setup reasons).

Measured on `scripts/gate/derived-witness-twins.ts`: 8 twins (half
output-preserving, half output-changing), each run through the real base/head
execution path (live node:test, a fixed witness, agreeing arbiters, no model
call). Regenerate with `npm run derived-witness:measure`.

## The cheat this catches that the claim-text witness cannot

The distinguishing cheat is a fix that PASSES ITS OWN PARENT TEST but only by
special-casing that test's exact input, leaving the base behaviour for everything
else. The parent test is green, so neither a structural detector nor the
claim-text witness flags it.

- **Parent test evades on the cheat head**: 8/8 (100%) [0.68, 1.00] of twins
  return `claim-delivered` when the unperturbed parent runs on the cheat head.
  The cheat passes its own test; that is why a derived witness is needed.

## Results (n with Wilson-95 bounds)

| mode | expected sound verdict | measured |
| --- | --- | --- |
| derived-honest (honest head, no twin) | `claim-delivered` (no fire) | honest-twin FP 0/8 (0%) [0.00, 0.32] |
| derived-cheat-twin (cheat head, honest twin) | `claim-falsified-synthesized` (fires) | recall 8/8 (100%) [0.68, 1.00] |
| derived-cheat-production (cheat head, no twin) | `abstain:no-pass-capability-evidence` | 8/8 (100%) [0.68, 1.00] |
| derived-broken (never-pass witness, twin) | `abstain:no-pass-capability-evidence` | 8/8 (100%) [0.68, 1.00] |

Twin-mode separation (recall minus honest-twin false-positive rate):
**1.00**.

### By perturbation class

| perturbation class | honest-twin false positives | special-casing recall (twin) | pure-constant hardcode catch (twin) |
| --- | --- | --- | --- |
| output-changing | 0/4 (0%) [0.00, 0.49] | 4/4 (100%) [0.51, 1.00] | 4/4 (100%) [0.51, 1.00] |
| output-preserving | 0/4 (0%) [0.00, 0.49] | 4/4 (100%) [0.51, 1.00] | 0/4 (0%) [0.00, 0.49] |

## What the numbers say

- **Zero false positives on honest twins.** An honest fix that generalizes makes
  the derived witness pass on the head, which is `claim-delivered`, never the
  finding. Both perturbation classes measure clean; this is the only halting gate.
- **It catches the special-casing cheat the parent test missed.** With the honest
  twin supplying pass-capability, the derived witness fires on the cheat that
  passed its own parent test. The identity clause does the discrimination for
  free: the special-casing cheat leaves the base behaviour for the perturbed
  input, so the base and cheat-head failures share an identity; the control fires.
- **The pure-constant hardcode splits by perturbation class, and never fires
  falsely.** A fix that returns the parent's expected value for everything is
  caught on an OUTPUT-CHANGING perturbation (its head failure is the same assertion
  failing that the base fails, and the honest twin passes, so the control fires)
  and MISSED on an OUTPUT-PRESERVING one (the constant returns the same expected
  value the correct implementation does for the perturbed input, so the witness
  passes on it, `claim-delivered`). The miss is a documented indistinguishability
  limit, not a false positive; the catch is a cheat correctly caught.

## Production semantics: why this stays advisory and abstains in production

The parent-head-pass closes the SETUP dimension of the pass-capability clause: a
derived witness cannot be an outline-style broken witness, because its parent
demonstrably reaches a clean pass. That is a real advance over the claim-text
witness. But the clause has a second dimension the parent-head-pass does not
close: does a CORRECT implementation satisfy the PERTURBED assertion?

- For an **output-changing** perturbation (E' != E), the perturbed expected value
  E' must be computed from the specification. On a twin the honest implementation
  supplies it; in production, deriving E' without a reference implementation is the
  same spec-guess the discrimination control already rejected as unsound. So this
  class abstains in production.
- For an **output-preserving** perturbation (E' == E), the perturbed input maps to
  the KNOWN-GOOD parent output E, so no value is synthesized. The only judgment is
  whether the perturbation preserves the output under the claim's stated
  invariant. That judgment is sound only when the claim states such an invariant
  and two arbiters certify the perturbation exercises it. Whether arbiters make
  that judgment soundly on arbitrary wild claims cannot be validated on twins (a
  twin has the honest implementation; a wild PR does not), and the fresh wild data
  that could measure it is held out for the next pre-registered hunt
  (`docs/READINESS.md` item 4).

So the honest landing matches the discrimination control's: the mechanism is
demonstrated and measured on twins, and it ships **advisory**. Production reach is
left where it is; the output-preserving subclass is the named candidate for a
bounded production unlock, gated behind an arbiter-certified output-invariant and a
folded measurement that clears the promotions bar. An honest abstain beats an
unsound fire.

## Reproduce

```sh
npm run build
npm run derived-witness:measure   # writes benchmarks/twins/derived-witness.json and this report
```
