# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after, with the reason for any next launch. Agent
minutes are the arm's own process wall, from spawn to exit or kill. Preparation and scoring are
reported apart. The allowance is eight launches, 15 minutes each and 120 agent-minutes in all
([protocol.md](protocol.md)).

Before the first launch, the driver was run for both arms against the product's scripted endpoint
(no model, so these are driver tests, not launches). Swarm's development arm behaved as the
validation predicts: the injected candidate passed the visible and preserve checks and failed the
counterexample and the relation. OpenCode's made no request in three minutes: the driver left its
stdin open, and `opencode run` reads a piped stdin into its message and waits for its end. The
driver now closes stdin, as the comparison harness does, and the dry run's single request answered
in 1.4 s.

| # | experiment | build | configuration | started (UTC) | agent minutes | running total | usage | outcome and next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A, Swarm | `afd12a65f` (`~/.cache/swarm-comparison/tools/swarm-afd12a65f`, `npm ci`, `npm run build`); driver `9568820e1` | `run.mjs --arm swarm --mode development`; `qwen3.6:35b-a3b` (`096fdbd02fe6`, loaded with an empty request, no tokens generated); thinking off; injected faulty candidate; supplied visible check and the three development checks; no `--plan-checks`; `--max-wall-minutes 14`; 15-minute kill | 2026-10-18 15:21:49 | 8.2 | 8.2 | 80 live calls, 1,777,458 prompt and 29,221 completion tokens, every call reporting usage | **Supplied-check repair shown, on the exposed task.** The acceptance gate refused the injected candidate on the counterexample and the relation. Repair 1 rewrote the expressions and broke one project test; the ratchet rolled it back. Repair 2 replaced `^.*` with `[\s\S]*` in both expressions, so line terminators are ordinary characters (it also changed `hasPath` to compare against `path.toLowerCase().length`, which is unneeded). The product reported `accepted`, exit 0. On a fresh checkout of the exact patch all four checks and the project suite pass ([delivered-checks.json](launch-1/delivered-checks.json)); **the evaluator accepts it**: hidden tests, project tests and the audit ([final-verdict.json](launch-1/final-verdict.json)). **Next:** launch 2, the OpenCode arm, as registered. |
| 2 | A, OpenCode | OpenCode 1.14.48; driver `9568820e1` | `run.mjs --arm opencode --mode development`; `qwen3.6:35b-a3b` (`096fdbd02fe6`, resident since launch 1); thinking off as the harness configures it; the same starting tree as launch 1 (the injected candidate in the working tree); the same four checks named in the prompt; no external correction; 15-minute kill | | | | | |
