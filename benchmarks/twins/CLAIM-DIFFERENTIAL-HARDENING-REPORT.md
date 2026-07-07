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

## After: the validation gate is credit-gated

The Phase 2 acceptance gate — on the semi-synthetic twin set, the hardened engine
reaches a head-run verdict on a majority of entries where the sandbox provisions,
with **zero findings on honest twins** — requires live model calls (the witness
compile and the two arbiters). The Anthropic credit probe returns HTTP 400
"credit balance is too low" (`evidence/lift/BASELINE.md`), so this gate could not
run. It is not skipped: the engine is built and unit-validated, and the gate runs
the moment a credit probe passes.

Reproduce when credits return:

```sh
npm run build
# ANTHROPIC_API_KEY funded; SWARM_EG_NODE_BIN=/path/to/node@22/bin.
# Run the hardened engine over the semi-synthetic twin set and read the per-reason
# abstain distribution and the honest-twin finding count (must be zero).
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/claim-differential-measure.js
```

A finding on an honest twin is stop-the-line, not a data point: it would trigger a
fresh-clone replay and a control-vs-label diagnosis before any number is trusted.

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
