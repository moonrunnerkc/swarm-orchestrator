# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after, with the reason for any next launch. Agent
minutes are the arm's own process wall, from spawn to exit or kill. Preparation and scoring are
reported apart. The allowance is five launches, 15 minutes each and 75 agent-minutes in all
([protocol.md](protocol.md)).

| # | experiment | build | configuration | started (UTC) | agent minutes | running total | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R1, ordinary run | `e2b0fe77c` (`~/.cache/swarm-comparison/tools/swarm-e2b0fe77c`, `npm ci`, `npm run build`); driver `../../2026-10-18/generated-check-control/run.mjs` (`sha256:3d2061e7f731...`) | `run.mjs --arm swarm --mode ordinary`; `qwen3.6:35b-a3b` (`096fdbd02fe6`, loaded with an empty request, no tokens generated); thinking off; nothing injected; the visible check only; `--plan-checks`; `--max-wall-minutes 14`; 15-minute kill | (entered before the start) | | | | |
