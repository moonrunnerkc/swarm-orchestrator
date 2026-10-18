# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its hypothesis, commit and configuration; its
duration, usage and outcome are filled in after, with the reason for any next attempt. Agent minutes
are the product invocation's own wall, from spawn to exit or kill. Preparation and the evaluator's
scoring are reported apart. The allowance is eight launches or 120 agent minutes, whichever comes
first ([protocol.md](protocol.md)).

| # | experiment | hypothesis | build | configuration | started (UTC) | agent minutes | running total | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R | A live repair, told the supplied counterexample's failing cases and the injected candidate, rewrites the two regular expressions so line terminators are ordinary characters, passing the counterexample, the visible check, the project tests and the evaluator's audit. | `41bfcff35` (`~/.cache/swarm-comparison/tools/swarm-41bfcff35`, `npm ci`, `npm run build`) | `run.mjs --mode supplied`; `qwen3.6:35b-a3b` (digest `096fdbd02fe6`, loaded with an empty request beforehand, no tokens generated); thinking off; supplied visible check and counterexample; no `--plan-checks`; `--max-wall-minutes 14`; 15-minute kill | (filled at start) | | | | |
