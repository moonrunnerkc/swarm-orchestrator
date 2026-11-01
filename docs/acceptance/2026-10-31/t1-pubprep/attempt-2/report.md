# swarm run: incomplete

Task: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid.

Model: qwen3.6:35b-a3b (conservative default: the largest installed model that fits and passed its readiness probe, needs 24.6 GiB at a 32768-token context, 145.2 tok/s in its probe; no finished tasks recorded for it here yet). Stopped: no-progress, the same command printed the same output 3 turns running.

| Requirement | Kind | Source | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| R1: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid. | fix | user | unverified | none | no executed evidence is mapped to this requirement |

- Delivered patch: `/Users/brad/.swarm/sessions/20261101T013406-9a84a6/final/delivered.patch`, sha256 c544b835665df2984c5e420a3ddd2ccf16b420b061fd975d0aa5ba369f123e86, against base 99d8d054753b4e8979431eb58792895c754fbdc9.
- Verification of that patch: fresh.
- Starting state: HEAD 99d8d054753b4e8979431eb58792895c754fbdc9, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: found.
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261101T013406-9a84a6/final/verification/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 23 model turn(s); 235859 input and 6752 output token(s) (reported by the runtime); 62 s of inference and 73 s of wall time; 0 retried request(s); 0 escalation(s); 0 verification(s) in the loop; cost: none (local runtime).
