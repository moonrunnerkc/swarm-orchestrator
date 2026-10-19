# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Agent minutes are the arm's own process wall,
from spawn to exit or kill. Preparation and scoring are reported apart. The allowance is five
launches, 15 minutes each and 75 agent-minutes in all ([protocol.md](protocol.md)).

| # | experiment | build | configuration | started (UTC) | agent minutes | running total | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | D1, development trial | `9a5052750` (`~/.cache/swarm-comparison/tools/swarm-9a5052750`, `npm ci`, `npm run build`, `dist/cli.js` `sha256:da219bb91bf6...`); runner `scripts/comparison/run.mjs` (harness `sha256:21b410beead5...`) | manifest [d1/manifest.json](d1/manifest.json) (`sha256:fbca0e0be29c...`): `marked-bugfix-www-case`, `qwen3.6:35b-a3b` (`096fdbd02fe6`), `--plan-checks`, the visible check only, 14 minutes and half a second with a 59.5-second grace, no correction; `run.mjs --manifest d1/manifest.json` | 2026-10-19 21:52:40 | | | | |
