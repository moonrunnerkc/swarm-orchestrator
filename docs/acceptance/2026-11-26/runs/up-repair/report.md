# swarm run: complete

Task: GET /invoices/:id/download returns an invoice to any signed-in user. Make it return the invoice only to the authenticated user who owns it; any other user gets 404.

Model: gemma4:31b (named by --model). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Witness | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1: GET /invoices/:id/download returns an invoice to any signed-in user. Make it return the invoice only to the authenticated user who owns it; any other user gets 404. | user, required | other, with no evidence named |  | satisfied | independent | test/download.accept.test.ts::another customer gets 404 for an invoice that is not theirs (fixed, user-acceptance); test/download.accept.test.ts::the owner still downloads their invoice (preserved, user-acceptance) |  |
| R2: The files the change adds or edits follow the approved coding conventions: exports named, function-names camelCase, variable-names camelCase, type-names PascalCase, file-names kebab-case, explicit-any forbidden, exported-return-types explicit, exported-docs documented | profile, required | other, with no evidence named |  | satisfied | independent | exports: named (observed, user-acceptance); function-names: camelCase (observed, user-acceptance); variable-names: camelCase (observed, user-acceptance); type-names: PascalCase (observed, user-acceptance); file-names: kebab-case (observed, user-acceptance); explicit-any: forbidden (observed, user-acceptance); exported-return-types: explicit (observed, user-acceptance); exported-docs: documented (observed, user-acceptance) |  |
| R3: Only its owner can reach the resource the task serves: another user, another role and an unauthenticated request are refused by the server, and the owner is still served (its check sends GET /invoices/inv-1/download and requests like it straight to the server) | security, required | other, with no evidence named |  | satisfied | independent | behavior security-ownership-1::the owner is served (preserved, user-acceptance); behavior security-ownership-1::another user is refused (fixed, user-acceptance); behavior security-ownership-1::an unauthenticated request is refused (preserved, user-acceptance); behavior security-ownership-1::a user of another role is refused (fixed, user-acceptance) |  |

- Your check: R1, user-acceptance: accept-R1-1, test/download.accept.test.ts.
- Delivered patch: `/Users/brad/projects/recovery-2026-10-31/run-assure/runs/up-repair/home/sessions/20261126T225308-40f75d/final/delivered.patch`, sha256 39394a7bf6ed2152b4ca4132ed422b99a4b3211556cd14bc6286a7ad419f825b, against base 1c416cdfd6ba59ceb9a3aaef3a91f757e7723df5.
- Verification of that patch: reused.
- Changed: src/app.ts (modified).
- Starting state: HEAD 1c416cdfd6ba59ceb9a3aaef3a91f757e7723df5, no uncommitted edits.
- Applied to the workspace: no, kept as a patch, as asked.
- Regression: none.
- The model's commands: isolated: each command in a container of node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed, only the workspace writable.
- Verification: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared; memory 4096 MiB with no swap and 2 CPUs, per container.
- Attestation: /Users/brad/projects/recovery-2026-10-31/run-assure/runs/up-repair/home/sessions/20261126T225308-40f75d/verifications/1/attestation.sigstore.json, verified with /Users/brad/projects/recovery-2026-10-31/run-assure/runs/up-repair/home/sessions/20261126T225308-40f75d/verifications/1/attestation.pub.pem (evidence signed).
- Instructions loaded: none.
- Resources: 6 model turn(s); 16174 input and 778 output token(s) (reported by the runtime); 47 s of inference (11 s reading prompts, 34 s writing replies) and 69 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: none (local runtime).
- Note: Conventions: the approved profile swarm.conventions/v1, sha256 3e7b0ed67bc370f0317c7975f132c9a46adee4613f2b0fec8804247e1eea1fa9, as it stood when the run started.
- Note: Security: ownership applies: the task names a resource that belongs to one user ("authenticated"), and the repository holds an HTTP API (routes in src/server.ts).
- Note: Security: single-use-token does not apply: the task does not name a token, link or code that is redeemed.
- Note: Security: duplicate-operation does not apply: the task does not name an operation that must not be applied twice.
