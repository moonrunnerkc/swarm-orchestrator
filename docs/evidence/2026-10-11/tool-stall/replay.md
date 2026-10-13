# Repeated-tool-call stall: the recorded case and its deterministic replay

The September development pilot reported a worker that "looped on one inspection command for
dozens of steps and never changed the manifest" ([campaign record, finding 12](../../2026-09-29/campaign/README.md)).
This page names the recorded session, what it holds, and what the loop's repeated-call detector
does with the same sequence. No model and no network were used for the replay.

## The record

Session `20260930T035141-b70d6c` (launch `b.dev-dotenvexpand-upgrade-primitives.b2-sv-baseline.r1`,
round 3 of the development pilot, swarm revision `fe156faf957`, model `local:qwen3.8:27b`), read
from its ledger under `~/.swarm/sessions/`:

| What the ledger holds | Count |
| --- | --- |
| model calls | 72 |
| loops (implementation, then repairs) | 4 |
| terminal tool calls | 80 |
| the one shell command that writes `package.json` and prints it, repeated in consecutive steps with byte-identical output (exit 0) | 35 |
| the one shell command that prints the lockfile's installed version, repeated with identical output | 28 |
| tokens spent | 1,010,599 |
| how it ended | `max-steps`, then `max-tokens`; final verification refused (fresh checkout could not install); the run then ended on a schema error with no result line |

Every one of the 80 tool outcomes differs from every other only in the evidence-record trailer
the chokepoint appends, which names the record each call produced.

## The replay

`scratchpad/replay-stall.mjs` (kept with this session's working files, not committed: it reads a
session directory this repository does not carry) feeds the terminal tool-call records, in
ledger order and grouped by loop, into `createStallTracker()` from `src/core/tool-stall.ts`
with the default policy (window 16, threshold 3), and applies the loop's rule: one notice, then
a stop.

```
terminal tool calls: 80; model calls: 72; loops: 4
loop 1, step 9,  ledger sequence 86:  shell repeated (repeats 3): feedback
loop 1, step 12, ledger sequence 107: shell repeated (repeats 3): stop
model calls up to the stop: 12 of 72; tokens up to the stop: 138605 of 1010599
```

The fourth identical call arrives at step 9 of the first loop and earns the notice; three more
identical calls follow in the record, so the loop would have stopped at step 12. What the model
would have done after a notice is not in the record, so the counts after the notice are the
recorded sequence replayed, not a prediction of a changed one.

## What the code does now

Beside the text-repetition detector (one response repeating a marker), the loop keeps a window
of recent call-and-result fingerprints and counts consecutive observations it has already seen.
A changed answer, an edit, and a reread that shows the edit are new; a denied call retried
unchanged and the same inspection with the same answer are not. The decisions are
`session-budget` records with `rule: "tool-stall-v1"`, `stall` events on the stream and rows on
the screen, and the stop reason is `stalled`. The gates still run over whatever the tree holds.
The regression cases are in `src/core/tool-stall.test.ts`, `src/core/loop.test.ts` and
`src/agent-run.test.ts`.

The live confirmation of the same goal on the current source is recorded in
[live-run.md](live-run.md).
