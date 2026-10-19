# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Agent minutes are the arm's own process wall,
from spawn to exit or kill. Preparation and scoring are reported apart. The allowance is one
development launch of at most 15 minutes, with one infrastructure replacement
([protocol.md](protocol.md)). The D1 replays of [README.md](README.md) section 2 used no model and
are not launches.

| # | experiment | build | configuration | started (UTC) | agent minutes | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | development launch, Swarm with `--plan-checks` on `marked-bugfix-www-case` | `b148573e3` (`~/.cache/swarm-comparison/tools/swarm-b148573e3`, `npm ci`, `npm run build`, `dist/cli.js` `sha256:c371adadda72...`); runner `scripts/comparison/run.mjs` unchanged (harness `sha256:21b410beead5...`, D1's) | manifest [launch/manifest.json](launch/manifest.json) (`sha256:ed42af4a20da...`): `qwen3.6:35b-a3b` (`096fdbd02fe6`) on Ollama 0.32.14, `--plan-checks`, the visible check only, 14 minutes and half a second with a 59.5-second grace, no correction, as D1; `run.mjs --manifest launch/manifest.json` | entered 2026-10-19 23:40, before the start | | | |
