# Every model-powered launch of this work, in order

Each launch is entered here before it starts; its outcome is filled in after. Agent minutes are
the product invocation's own end-to-end wall, from spawn to exit or kill. Preparation (clone,
install, build) and the evaluator's scoring are reported apart. The allowance is six launches or
90 agent minutes, whichever comes first ([protocol.md](protocol.md)).

| # | kind | build | model | started (UTC) | agent minutes | running total | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | unplanned onboarding probe | `8713d6495` (source, `node src/cli.ts`) | `gemma4-31b-greedy-128k` (picked by default; not the protocol's model) | 2026-10-17 22:29:48 | 1.6 | 1.6 | **Not part of the plan; counted.** An auditing agent reading the first-run path ran `swarm "…" --plan-checks` in a scratch repository without `--model`. With nothing pinned, the run took the first model Ollama served and planned checks and implemented for 95.6 s (ledger `20261017T222948-e881b8`) before the agent killed it and unloaded the model. It showed the silent default-model pick the first-run fixes now name. No result is claimed from it. |
| 1 | onboarding trial ([onboarding.mjs](onboarding.mjs)) | `df5fb0a01` (packed tarball, installed globally in a private prefix) | `qwen3.6:35b-a3b` | 2026-10-17 23:23:56 | 0.0 | 1.6 | **No model reached; counted as a launch.** The README's install line, `npm install -g "$(npm pack --silent)"`, failed: `npm pack` runs `prepare`, whose build prints a progress line on stdout, so the substitution held two lines and npm read the first as a URL (`EUNSUPPORTEDPROTOCOL`). Every later step had no `swarm` to run ([launch-1/onboarding.json](launch-1/onboarding.json)). A first-run defect in the documented route, found by walking it: the README now says `npm pack`, then `npm install -g ./swarm-orchestrator-*.tgz`. |
