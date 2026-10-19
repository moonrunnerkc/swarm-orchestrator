# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after, with the reason for any next launch. Agent
minutes are the arm's own process wall, from spawn to exit or kill. Preparation and scoring are
reported apart. The allowance is five launches, 15 minutes each and 75 agent-minutes in all
([protocol.md](protocol.md)).

| # | experiment | build | configuration | started (UTC) | agent minutes | running total | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R1, ordinary run | `e2b0fe77c` (`~/.cache/swarm-comparison/tools/swarm-e2b0fe77c`, `npm ci`, `npm run build`); driver `../../2026-10-18/generated-check-control/run.mjs` (`sha256:3d2061e7f731...`) | `run.mjs --arm swarm --mode ordinary`; `qwen3.6:35b-a3b` (`096fdbd02fe6`, loaded with an empty request, no tokens generated); thinking off; nothing injected; the visible check only; `--plan-checks`; `--max-wall-minutes 14`; 15-minute kill | 2026-10-19 15:28:36 | 5.7 | 5.7 | 47 live calls, 813,941 prompt and 16,808 completion tokens (planning 638,008 tokens), every call reporting usage | **Pass of this run.** The product reported `accepted`, exit 0, with no repair. The exact patch takes the directory part with `[\s\S]*` and the extension after `lastIndexOf('.')`; the frozen evaluator accepts it ([final-verdict.json](launch-r1/final-verdict.json)) and so does the expanded audit, development contract and custom extension included ([expanded-audit.json](launch-r1/expanded-audit.json)). No request carried the faulty patch, the upstream change or the evaluator ([exposure.json](launch-r1/exposure.json)). Planning admitted seven checks, three of them relations, with no revision. Per candidate ([candidates/](launch-r1/candidates/repair-value.json)): the first implementation, rebuilt exactly from its tool calls, is the delivered one and is correct; no repair ran. **Next:** R2, as registered, on the same build. |
| 2 | R2, ordinary run (pre-registered repetition) | `e2b0fe77c`, unchanged | as launch 1 | (entered before the start) | | | | |
