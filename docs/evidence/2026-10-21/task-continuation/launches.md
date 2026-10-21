# Every model-powered launch of this follow-up, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests
and usage apart from the task's. The allowance for the whole stage is at most six live launches
and 60 agent-minutes of inference and failed starts, at most two of them development launches
([protocol.md](protocol.md)). The reconstruction, the real-tree checks, the controller replay,
the regression tests, the build and the preflight used no model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| the task | `sinon-bugfix-stub-accessor-calls-v2`, unchanged since `d2437c430`; validation and the API check's sensitivity as recorded for the first trial |
| Swarm build | commit `87b6f294e`, `~/.cache/swarm-comparison/tools/swarm-87b6f294e`, `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:3503870a31f1...`, 864 files under `dist/` |
| endpoint before launch | Ollama serving `qwen3.6:35b-a3b` (version in the launch row), nothing resident before the launch, nothing else heavy running |

## Launches
