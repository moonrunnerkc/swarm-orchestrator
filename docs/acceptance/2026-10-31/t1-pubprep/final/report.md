# swarm run: complete

Task: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid.

Model: qwen3.8:27b (named by --model). Stopped: complete.

| Requirement | Kind | Source | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| R1: Make --max-budget-usd also accept --max-budget-usd=<n>. Reject an empty value (--max-budget-usd=). When the next token is another flag (--max-budget-usd --dry-run), report that it requires a numeric value instead of 'got: --dry-run'. 0 stays valid. | feature | user | satisfied | test/cli.test.ts::parseArgs > parses --max-budget-usd=<n> (witness, implementation-authored) |  |
| R2: Reject empty value --max-budget-usd= with a non-negative-number error | fix | inferred | satisfied | test/cli.test.ts::parseArgs > rejects --max-budget-usd= with an empty value (witness, implementation-authored) |  |
| R3: When next token is another flag, report 'requires a numeric value' instead of 'got: <flag>' | fix | inferred | satisfied | test/cli.test.ts::parseArgs > rejects --max-budget-usd followed by another flag (witness, implementation-authored) |  |
| R4: 0 stays valid for --max-budget-usd | other | inferred | satisfied | test/cli.test.ts::parseArgs > parses --max-budget-usd <n> (preserved, pre-existing) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261101T140245-7b55bf/final/delivered.patch`, sha256 39cc68d382de9284f1a4b924442956d74c99453c30b256f477b88a5627949161, against base 99d8d054753b4e8979431eb58792895c754fbdc9.
- Verification of that patch: reused.
- Changed: src/cli.ts (modified); test/cli.test.ts (modified).
- Starting state: HEAD 99d8d054753b4e8979431eb58792895c754fbdc9, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: none.
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261101T140245-7b55bf/verifications/1/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 32 model turn(s); 290094 input and 6135 output token(s) (reported by the runtime); inference time not reported by the runtime and 425 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: unknown: the endpoint reports no price.
