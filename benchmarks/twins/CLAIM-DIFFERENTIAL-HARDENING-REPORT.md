# Claim-differential hardening: the three Hunt 3 defects, fixed and recorded

The Hunt 3 autopsy found two defects and one conformance gap in the
claim-differential engine, all three ours. This report records the fixes, the
deterministic evidence that they work, the honest handling of the temperature
conformance gap, and the one gate that stays blocked on Anthropic credits.

Held-out discipline: witness compilation, prompts, controls, and verdict mapping
are detection logic, so every fix here was developed and validated against
synthetic stubs and fixture workspaces only. No wild entry was read to build or
tune any of it.

## Before: the Hunt 3 abstain distribution

Over the four EG-viable entries that provisioned (`benchmarks/real-prs/hunt3/records/`):

| claim-differential verdict | count | entries |
| --- | --- | --- |
| `abstain:witness-not-compiled` | 3 | SkateHubba, vite-plugin-react, cybersemics/em (credit-cut) |
| `abstain:closure-unlinked` | 1 | poetry-bil-araby |
| findings (`claim-falsified-synthesized`) | 0 | — |

The funded frontier variant of the same run reached `closure-unlinked` on
cybersemics/em too (`WILD-CLAIM-DIFFERENTIAL-REPORT.md`), so the credit-independent
distribution is witness-not-compiled ×2, closure-unlinked ×2. Either way: **the
engine never reached a head-run verdict** on this slice; every entry died at the
compile or closure stage.

## Fix 1: witness-not-compiled (the model emits no test)

Root cause in the compile layer: the model spent its output budget reasoning and
emitted no runnable test. Three changes, all fail-closed:

- **Structured-output contract.** `claim-llm.ts` now requests the witness through
  `output_config.format` (a `{ test_source }` json_schema), so the reply must be
  the test rather than free prose competing with the reasoning. `effort:low` keeps
  the thinking short so emission cannot starve. (Assistant prefill, the other
  budget-split option, returns HTTP 400 on `claude-sonnet-5`, so structured output
  is the only viable contract here.)
- **Reasoning stripped before parse.** `extractWitnessCandidate` removes a leading
  reasoning block, then takes a fenced code block if present, else the bare source
  a structured reply returns.
- **One format-only retry.** An empty first emission is retried once with a
  reminder to emit only code; the recovery is recorded per witness (`retried`).

Evidence (unit tests, `claim-differential.test.ts`):
`retries once with a format reminder when the first emission carries no test`
(exactly one retry, `retried:true`), `accepts a bare (unfenced) test source`, and
`fails closed to null when neither the first emission nor the retry has a test`.

## Fix 2: closure-unlinked (the witness imports nothing the PR changed)

Root cause: the compiler never told the model what changed, so a witness written
from claim text alone could not import the revertable unit. The closure control
then correctly abstained. Fix, with the control left byte-identical:

- **Feed the changed units.** `claim-differential.ts` computes the
  behaviorally-revertable changed files (`behaviorallyRevertableSourceFiles`) and,
  via `claim-changed-units.ts`, their exported symbols read from the head checkout,
  and passes them into the compiler. The prompt now names the files to import.
- **Static import validation before any sandbox run.** The compiled witness's
  import closure is checked with the same `reachableSourceFiles` /
  `closureLinksChangedSource` the control uses; an unlinked witness is regenerated
  once with the exact files to import (recorded as `regeneratedForClosure`).

Evidence: `regenerates once, naming the changed file, when the first witness
imports nothing changed` (the regeneration prompt names `adder.js`, the regenerated
witness imports it) and `does not regenerate when the first witness already imports
a changed unit`. The closure control's own test (`evaluateClosureControl`) is
unchanged and still green.

## Fix 3: temperature conformance (recorded honestly, not faked)

The Hunt 3 reproduce section admitted the witness compile is nondeterministic (no
fixed temperature). The intended fix was to pin temperature 0 "like the rest of the
engine." **That pin is impossible on the pinned witness model:** `claude-sonnet-5`
rejects an explicit `temperature` with an HTTP 400 (the judge path omits it for the
same reason). Setting temperature 0 would break the live call.

So the contradiction is closed by recording, not by a false pin. Every witness now
carries `samplingPolicy`
(`temperature-unset (claude-sonnet-5 rejects explicit temperature); output_config.effort=low`),
its `model`, `promptVersion` (bumped `cw-v1` → `cw-v2` with the reworded prompt),
`promptHash`, `retried`, and `regeneratedForClosure`, and all of these are written
into the hunt3 ledger record. A replay now knows exactly how the witness was
sampled; it is honestly not temperature-pinnable on this model, and the record says
so rather than implying otherwise.

## After: funded evaluation (Hunt 4) and the gap it exposed

The maintainer topped up credits mid-run, so the hardened engine ran live. The
funded evaluation is Hunt 4 (`benchmarks/real-prs/hunt4/HUNT-4-REPORT.md`): the
hardened engine over the six provisioned held-out wild entries. What the fixes did,
measured:

| claim-differential verdict | Hunt 3 (4 provisioned) | Hunt 4 (6 provisioned) |
| --- | --- | --- |
| `witness-not-compiled` | 3 | **0** |
| `arbiter-disagreement` | 0 | 3 |
| `closure-unlinked` | 1 | 2 |
| `claim-falsified-synthesized` | 0 | 1 (diagnosed false positive) |

**Fix 1 works live:** every witness now compiles (`witnessRetried: false` on all
entries), so the engine reaches the real controls instead of dying at emission.
**Fix 2 works live:** on poetry-bil-araby the closure regen fired
(`regeneratedForClosure: true`) with the changed files named. **Fix 3 works live:**
every record carries the sampling provenance
(`temperature-unset ...; output_config.effort=low`, model, prompt cw-v2).

But reaching the controls surfaced a real gap the unit tests could not: on
outline/outline#12197 the engine returned `claim-falsified-synthesized`, and the
stop-the-line diagnosis (`benchmarks/real-prs/hunt4/outline-diagnosis.md`) shows it
is a **false positive**. The synthesized witness fails identically on base and head
because it cannot reproduce a cached-counter setup, and the controls (arbiter
agreement, closure link, base-fails-twice) do not include a **discrimination /
positive control** — nothing establishes the witness would pass on a correct
implementation. `claim-falsified-synthesized` ("base fails AND head fails") is
therefore satisfiable by a witness that fails everywhere for its own reasons.

## The remaining gate, and the discipline boundary

The Phase 2 acceptance gate as literally specified — zero findings on **honest
twins** — is a detection-logic development gate that should run on the
semi-synthetic twin pairs. Those pairs are diffs-to-apply over external (largely
Python) source PRs, and no instrument provisions them through the claim-differential
base/head path; `claim-differential-measure.ts` runs over the wild corpus, not the
twins. Building a twin-provisioning claim-differential harness is out of this run's
scope, so the honest-twin false-positive rate was not measured on the twin set.
What the funded wild evaluation shows instead is that the false-positive path is
real (outline), so the discrimination control is required.

That control is **not** built here: this run already read outline to diagnose the
fire, and held-out discipline forbids iterating detection logic against a wild
entry. The fix — require a `claim-falsified-synthesized` witness to discriminate
(pass on a correct implementation, or produce a materially different base-vs-head
outcome) — is designed from first principles and validated on the twin set as
disclosed future work. Until then, `claim-falsified-synthesized` stays an advisory
`warn` and never reaches the proven bar (which also requires a fresh-clone replay
the nondeterministic, unpersisted witness cannot satisfy).

## What changed, in files

- `src/audit/execution-grounded/claim-changed-units.ts` (new): changed-unit and
  exported-symbol extraction, prompt rendering.
- `src/audit/execution-grounded/claim-witness-compile.ts` (new): the compile half,
  with retry, reasoning-strip, and closure-linked regeneration.
- `claim-witness.ts`: `Completer`/`ClaimWitness` gain `samplingPolicy`, `retried`,
  `regeneratedForClosure`; compile logic re-exported from the new module.
- `claim-differential.ts`: feeds the changed units, threads the new provenance.
- `claim-llm.ts`: structured-output contract, `samplingPolicy`,
  `witnessSourceFromResponse`.
- `scripts/real-prs/hunt3.ts`: records the new provenance in the ledger.
