# Phase 2 run summary (config B)

- Patch SHA: `89d84fd606c2998d2cce064cdd03bb2e94dc8080`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-1-gate`
- Fixture content hash: `b7f129e7335e96e1a1166828eac6696f24bd140f7378d1fa86199a621feacd25`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 30
- Pass count: 2 (passes when system returns no falsification)
- Counter-examples returned (machine-claimed): 78
- Errored obligations: 2
- Cost-cap hits: 0
- Total wall-clock: 13.3 s
- Total LLM calls: 29
- Total dollars (billed): $4.3994
- Total dollars (token estimate): $4.3994

| id | stratum | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| A1 | A | no | counter-example-input | 3 | 0 | 0.1493 | 0.1493 | 1 | 17933 |  |  |
| A2 | A | no | counter-example-input | 3 | 0 | 0.1444 | 0.1444 | 1 | 9450 |  |  |
| A3 | A | no | counter-example-input | 3 | 0 | 0.0227 | 0.0227 | 1 | 10116 |  |  |
| A4 | A | no | counter-example-input | 3 | 0 | 0.1502 | 0.1502 | 1 | 12461 |  |  |
| A5 | A | no | counter-example-input | 3 | 0 | 0.1499 | 0.1499 | 1 | 14539 |  |  |
| A6 | A | no | counter-example-input | 3 | 0 | 0.1510 | 0.1510 | 1 | 13902 |  |  |
| A7 | A | no | counter-example-input | 3 | 0 | 0.2880 | 0.2880 | 1 | 11650 |  |  |
| A8 | A | no | counter-example-input | 3 | 0 | 0.1516 | 0.1516 | 1 | 12381 |  |  |
| A9 | A | no | counter-example-input | 3 | 0 | 0.1531 | 0.1531 | 1 | 11313 |  |  |
| A10 | A | no | counter-example-input | 3 | 0 | 0.1507 | 0.1507 | 1 | 11441 |  |  |
| A11 | A | no | counter-example-input | 3 | 0 | 0.1504 | 0.1504 | 1 | 16195 |  |  |
| A12 | A | no | counter-example-input | 3 | 0 | 0.1507 | 0.1507 | 1 | 17547 |  |  |
| B1 | B | no | counter-example-input | 3 | 0 | 0.1518 | 0.1518 | 1 | 11694 |  |  |
| B2 | B | no | counter-example-input | 3 | 0 | 0.1508 | 0.1508 | 1 | 11323 |  |  |
| B3 | B | no | counter-example-input | 3 | 0 | 0.1507 | 0.1507 | 1 | 12145 |  |  |
| B4 | B | no | counter-example-input | 3 | 0 | 0.1589 | 0.1589 | 1 | 11804 |  |  |
| B5 | B | no | counter-example-input | 3 | 0 | 0.1481 | 0.1481 | 1 | 8622 |  |  |
| B6 | B | no | counter-example-input | 3 | 0 | 0.0282 | 0.0282 | 1 | 9555 |  |  |
| B7 | B | yes | no-falsification-found/no-counter-example-discovered | 0 | 3 | 0.1486 | 0.1486 | 1 | 16800 |  |  |
| B8 | B | no | counter-example-input | 3 | 0 | 0.1501 | 0.1501 | 1 | 12114 |  |  |
| B9 | B | no | counter-example-input | 3 | 0 | 0.2878 | 0.2878 | 1 | 12070 |  |  |
| B10 | B | no | counter-example-input | 3 | 0 | 0.2853 | 0.2853 | 1 | 8936 |  |  |
| B11 | B | no | counter-example-input | 3 | 0 | 0.1507 | 0.1507 | 1 | 14067 |  |  |
| C1 | C | no | errored | 0 | 0 | 0.0000 | 0.0000 | 1 | 32741 |  | codex exec failed with exit code 1. stderr: Reading additional input from stdin...
OpenAI Codex v0.130.0
--------
workdir: /private/var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/phase2-B-C1-peFUii/workspace
model: gpt-5.5
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/brad/.codex/memories]
reasoning effort: none
reasoning summaries: none
session id: 019e0e02-26b3-76c0-a143-40cf764ba341
--------
user
You are an adversarial test-input generator running inside a
workspace-write sandbox. Your task is to falsify the property-must-hold
obligation below by describing concrete inputs that would cause the
predicate command to exit with a non-zero status (the predicate exits
zero when the property holds; non-zero means the property does not).

Predicate target: no *.ts under src/falsification over 50 KB containing 'console'
Predicate command: ! find src/falsification -name '*.ts' -size +50k -exec grep -l 'console' {} + 2>/dev/null | grep -q .

Constraints, all hard:
1. Do NOT modify the workspace yourself. The orchest…[truncated] — surface the failure rather than treating it as no-falsification-found. |
| C2 | C | no | counter-example-input | 3 | 0 | 0.1459 | 0.1459 | 1 | 16495 |  |  |
| C3 | C | no | counter-example-input | 3 | 0 | 0.1522 | 0.1522 | 1 | 12172 |  |  |
| C4 | C | no | counter-example-input | 3 | 0 | 0.1500 | 0.1500 | 1 | 9731 |  |  |
| C5 | C | yes | no-falsification-found/no-counter-example-discovered | 0 | 3 | 0.1782 | 0.1782 | 1 | 50398 |  |  |
| C6 | C | no | errored | 0 | 0 | 0.0000 | 0.0000 | 0 | 300009 |  | codex exec exceeded the 300000ms time budget; the call was killed. Increase FalsificationInput.timeBudgetMs if the obligation legitimately needs more time. |
| C7 | C | no | counter-example-input | 3 | 0 | 0.1501 | 0.1501 | 1 | 13306 |  |  |

Pass = system returns no falsification (config A: predicate exits 0; config B: predicate exits 0 and Codex returns no counter-example). Cost-cap hits are flagged separately and counted as completions, not failures.
