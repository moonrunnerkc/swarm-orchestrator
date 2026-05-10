# Phase 1 dev gate — run summary

- Patch SHA: `f65d9a4b070970a2891b6ec37869c3fc9d4a0979`
- Obligations: 8
- Total wall-clock: 102.1 s
- Total dollars: $0.0000
- Counter-examples returned (machine-claimed): 21
- Errored obligations: 1

| id | stratum | result | yield | FP | $ | ms | codex_exit | error |
|---|---|---|---:|---:|---:|---:|---:|---|
| A1 | A | counter-example-input | 3 | 0 | 0.0341 | 14608 | 0 |  |
| A2 | A | counter-example-input | 3 | 0 | 0.0882 | 12803 | 0 |  |
| A3 | A | counter-example-input | 3 | 0 | 0.1192 | 15619 | 0 |  |
| A4 | A | counter-example-input | 3 | 0 | 0.0480 | 12878 | 0 |  |
| A5 | A | counter-example-input | 3 | 0 | 0.0483 | 12432 | 0 |  |
| A6 | A | counter-example-input | 3 | 0 | 0.0495 | 14533 | 0 |  |
| A7 | A | counter-example-input | 3 | 0 | 0.0473 | 13235 | 0 |  |
| A8 | A | errored | 0 | 0 | 0.0000 | 4693 | 1 | codex exec failed with exit code 1. stderr: Reading additional input from stdin...
OpenAI Codex v0.130.0
--------
workdir: /private/var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/phase1-gate-A8-GzCMFw/workspace
model: gpt-5.5
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/brad/.codex/memories]
reasoning effort: none
reasoning summaries: none
session id: 019e0d29-56ab-70d0-b2f4-f9071965bfab
--------
user
You are an adversarial test-input generator running inside a
workspace-write sandbox. Your task is to falsify the property-must-hold
obligation below by describing concrete inputs that would cause the
predicate command to exit with a non-zero status (the predicate exits
zero when the property holds; non-zero means the property does not).

Predicate target: no aws_secret_access_key token in repo
Predicate command: ! grep -rin 'aws_secret_access_key' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null

Constraints, all hard:
1. Do NOT modify the workspace yourself. The orchestrator app…[truncated] — surface the failure rather than treating it as no-falsification-found. |

Yield is *machine-claimed* only. Operator hand-inspection in inspection.md
determines confirmed-vs-false-positive yield.
