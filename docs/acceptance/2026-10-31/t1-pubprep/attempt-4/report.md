# swarm run: incomplete

Task: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid.

Model: qwen3.6:35b-a3b (conservative default: the largest installed model that fits and passed its readiness probe, needs 27.2 GiB at a 65536-token context, 118.4 tok/s in its probe; no finished tasks recorded for it here yet). Stopped: no-progress, the same command printed the same output 3 turns running.

| Requirement | Kind | Source | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| R1: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid. | feature | user | unverified | test/cli.test.ts::parseArgs > parses --max-budget-usd <n> (preserved, pre-existing) | no change observed |

- Delivered patch: `/Users/brad/.swarm/sessions/20261101T073830-a06de5/final/delivered.patch`, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, against base 99d8d054753b4e8979431eb58792895c754fbdc9.
- Verification of that patch: fresh.
- Starting state: HEAD 99d8d054753b4e8979431eb58792895c754fbdc9, no uncommitted edits.
- Applied to the workspace: no, the run changed nothing.
- Regression: none.
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261101T073830-a06de5/final/verification/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 13 model turn(s); 71143 input and 443 output token(s) (reported by the runtime); 9 s of inference and 28 s of wall time; 0 retried request(s); 0 escalation(s); 0 verification(s) in the loop; cost: none (local runtime).
