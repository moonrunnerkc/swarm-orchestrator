# swarm run: complete

Task: Add a --reviewers option to pubprep so a run can use only some of the three reviewers. It takes a comma-separated list of short names: tech-debt, docs and security, for tech-debt-reviewer, readme-docs-reviewer and security-reviewer. parseArgs returns the choice as `reviewers`, the full agent names in the order tech-debt, docs, security whatever order they were typed, each once even when repeated. Without the flag, leave `reviewers` unset; a run then uses all three, as now. A missing or empty value is an error naming the valid short names, and a name that isn't one of the three is an error naming it and the valid short names. orchestrate takes the same list as an optional `reviewers` param (all three when omitted) and runs only those reviewers, in parallel or in sequence, so only their reports are written and concatenated into combined-review.md; main passes the parsed list through. Document the flag in the --help text. Add tests.

Model: gemma4:31b, then escalated (the best record here: 86% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: Add a --reviewers option to pubprep so a run can use only some of the three reviewers. It takes a comma-separated list of short names: tech-debt, docs and security, for tech-debt-reviewer, readme-docs-reviewer and security-reviewer. parseArgs returns the choice as `reviewers`, the full agent names in the order tech-debt, docs, security whatever order they were typed, each once even when repeated. Without the flag, leave `reviewers` unset; a run then uses all three, as now. A missing or empty value is an error naming the valid short names, and a name that isn't one of the three is an error naming it and the valid short names. orchestrate takes the same list as an optional `reviewers` param (all three when omitted) and runs only those reviewers, in parallel or in sequence, so only their reports are written and concatenated into combined-review.md; main passes the parsed list through. Document the flag in the --help text. Add tests. | user | feature: tests parseArgs > parses --reviewers, parseArgs > rejects --reviewers without a value, parseArgs > rejects empty --reviewers value, parseArgs > rejects invalid reviewer names; checks typecheck, build |  | satisfied | test/cli.test.ts::parseArgs > parses --reviewers (witness, implementation-authored); test/cli.test.ts::parseArgs > rejects --reviewers without a value (witness, implementation-authored); test/cli.test.ts::parseArgs > rejects empty --reviewers value (witness, implementation-authored); test/cli.test.ts::parseArgs > rejects invalid reviewer names (witness, implementation-authored); typecheck (pass, pre-existing); build (pass, pre-existing) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261105T075907-93df60/final/delivered.patch`, sha256 c0c3b1e8047d4d423a1ed0ae5c325cdc2948b947555cbb45cf71bf8fce625b27, against base 99d8d054753b4e8979431eb58792895c754fbdc9.
- Verification of that patch: reused.
- Changed: src/cli.ts (modified); src/orchestrate.ts (modified); test/cli.test.ts (modified).
- Starting state: HEAD 99d8d054753b4e8979431eb58792895c754fbdc9, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: none.
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261105T075907-93df60/verifications/2/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 42 model turn(s); 315549 input and 9980 output token(s) (reported by the runtime); 860 s of inference and 955 s of wall time; 0 retried request(s); 1 escalation(s); 2 verification(s) in the loop; cost: none (local runtime).
