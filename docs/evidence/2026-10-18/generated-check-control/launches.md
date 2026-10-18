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
