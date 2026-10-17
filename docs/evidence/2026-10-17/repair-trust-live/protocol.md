# Live development runs of 2026-10-17 (evening): protocol

Registered before the first launch of this work. Results go in [README.md](README.md); every
launch, in order, is in [launches.md](launches.md), entered before it starts. This file is not
edited after the first launch.

## Status

**Development records on an exposed task.** The mime task, its retained faulty patch and its
audit's counterexamples are known to the people developing Swarm, and the task is a historical
public change that may be in the model's training data. Nothing here is fresh or comparative
evidence. The product changes these launches test (repair feedback after a rollback, generated
checks as diagnostics, the outcome status, `run_check`, the shell guard's reading of inline
programs) were written after reading the 2026-10-17 planned-check launches.

## Allowance

- **At most six model-powered launches or 90 agent-minutes, whichever comes first**, with a hard
  15-minute end-to-end limit per launch. Planning, implementation, repairs and the product's final
  verification all count. Workspace preparation and the evaluator's scoring are recorded apart.
- **Launch 0 is already spent:** a 1.6-minute model-powered run an auditing agent started by
  mistake while reading the first-run path (below, and in [launches.md](launches.md)).
- Every launch is entered in [launches.md](launches.md) before it starts and kept whatever
  happens, including failures and launches that are invalid for infrastructure reasons. No hidden
  retries, no unrecorded warm-ups, no paid API.

## Instrument

- **Model and server:** Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking
  off (the request options Swarm always sends), 8192 output tokens per call. One model resident,
  one request at a time, one launch at a time. These are the settings of the earlier 2026-10-17
  launches.
- **Build:** commit `df5fb0a01` of `fix/repair-trust-and-first-run`, frozen before launch 1 (its `npm run gates` passed: 461 test files, 4409 tests passed, 29 skipped), cloned and
  built with `npm ci`; each record names its commit.
- **Workspace (mime):** prepared as the comparison launcher prepares it
  (`scripts/comparison/workspace.mjs`): the original base cloned from the local mirror, the visible
  check committed, `npm ci --ignore-scripts`, the frozen `swarm.toml` gates, a private `HOME` per
  launch, `--plan-checks` with the supplied visible-check contract.

## Launch plan

1. **Onboarding trial**: the README's first run walked as written by [onboarding.mjs](onboarding.mjs)
   in a disposable root (private `HOME` and npm prefix, the packed tarball installed globally), the
   scratch repository and task the README gives, the README's model. Off a terminal.
2. **Seeded mime** (fault injection), by [run.mjs](run.mjs) `--mode seeded`: live planning, the
   retained faulty candidate written by the proxy as the first implementation, live repair, the
   product's final verification. The same task, base, candidate and settings as launch 11 of the
   earlier work.
3. **Ordinary mime**, by [run.mjs](run.mjs) `--mode ordinary`, only if launch 2 meets every
   condition below: nothing injected.
4. Launches 4 and 5 are held for a launch found invalid for an infrastructure reason (the server
   unreachable or crashed, the machine out of memory, the driver failing), each investigated and
   entered before it is replaced. A launch that ran as designed and failed is a result, not a
   reason to launch again.

## What counts as the seeded milestone

All of:

- the live planner wrote a check without being given the retained patch, the upstream change, the
  audit or the evaluator (checked by `../planned-check-live/scan-exposure.mjs` on the recorded
  requests);
- that check identifies the omission: it accepts the upstream control and rejects the retained
  faulty patch (`../planned-check-live/verify-checks.mjs`);
- a live repair fixed the omission: the final patch passes that check;
- the project's tests and the supplied visible check pass in the product's own final verification
  of the exact delivered tree;
- the evaluator accepts the exact final patch: the frozen oracle with the 113-case audit
  ([score.mjs](score.mjs));
- no person supplied or repaired any code.

The product's own outcome for such a run is expected to be `partially-checked`, since a planned
requirement is decided by no check; that is reported as it is and is not a failure condition.
The ordinary run is read by the same evaluator.

## Evaluation and records

- [score.mjs](score.mjs) scores each final patch; the evaluator's reading of the generated checks is
  `../planned-check-live/verify-checks.mjs`; the request scan is
  `../planned-check-live/scan-exposure.mjs`. Evaluation time is reported apart from agent time.
- Raw exchanges, stdout, stderr and ledgers are packed with `scripts/evidence-pack.mjs` before
  commit, as the earlier launches' were.
