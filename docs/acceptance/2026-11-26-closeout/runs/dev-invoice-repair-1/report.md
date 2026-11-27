# swarm run: complete

Task: GET /invoices/:id/download returns an invoice to any signed-in user. Make it return the invoice only to the authenticated user who owns it; any other user gets 404.

Model: gemma4:31b (named by --model). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Witness | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1: GET /invoices/:id/download returns an invoice to any signed-in user. Make it return the invoice only to the authenticated user who owns it; any other user gets 404. | user, required | fix, with no evidence named |  | satisfied | independent | test/invoices.swarm-r1.test.ts::GET /invoices/:id/download returns 404 to any other user (fixed, independently-generated); test/invoices.swarm-r1.test.ts::GET /invoices/:id/download returns the invoice to the authenticated user who owns it (preserved, independently-generated); test/invoices.swarm-r1.test.ts::control: GET /invoices/:id/download is reachable for signed-in users (preserved, independently-generated) |  |
| R2: The files the change adds or edits follow the approved coding conventions: exports named, function-names camelCase, variable-names camelCase, type-names PascalCase, file-names kebab-case, explicit-any forbidden, exported-return-types explicit, exported-docs documented | profile, required | other, with no evidence named |  | satisfied | independent | exports: named (observed, user-acceptance); function-names: camelCase (observed, user-acceptance); variable-names: camelCase (observed, user-acceptance); type-names: PascalCase (observed, user-acceptance); file-names: kebab-case (observed, user-acceptance); explicit-any: forbidden (observed, user-acceptance); exported-return-types: explicit (observed, user-acceptance); exported-docs: documented (observed, user-acceptance) |  |
| R3: Only its owner can reach the resource the task serves: another user, another role and an unauthenticated request are refused by the server, and the owner is still served (its check sends GET /invoices/inv-1/download and requests like it straight to the server) | security, required | other, with no evidence named |  | satisfied | independent | behavior security-ownership-1::each named user is signed in, and a request without credentials is not (preserved, independently-generated); behavior security-ownership-1::another user is refused (fixed, independently-generated); behavior security-ownership-1::an unauthenticated request is refused (preserved, independently-generated); behavior security-ownership-1::a user of another role is refused (fixed, independently-generated); behavior security-ownership-1::the owner is served (preserved, independently-generated) |  |

- Independent checks for R1: a test, run from test/invoices.swarm-r1.test.ts (read as fix), failing at the base, written without seeing the change.
- Delivered patch: `/Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-invoice-repair-1/home/sessions/20261127T041755-849c93/final/delivered.patch`, sha256 86aede540afcdab83b632fb9ebf0e06b9fa9bb0433b3839193912628ddd5f5b2, against base 2c83e4b755f112e2ebb91df17f233dc7cd2008c3.
- Verification of that patch: reused.
- Changed: src/app.ts (modified).
- Starting state: HEAD 2c83e4b755f112e2ebb91df17f233dc7cd2008c3, no uncommitted edits.
- Applied to the workspace: no, kept as a patch, as asked.
- Regression: none.
- The model's commands: isolated: each command in a container of node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed, only the workspace writable.
- Verification: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared; memory 4096 MiB with no swap and 2 CPUs, per container.
- Attestation: /Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-invoice-repair-1/home/sessions/20261127T041755-849c93/verifications/1/attestation.sigstore.json, verified with /Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-invoice-repair-1/home/sessions/20261127T041755-849c93/verifications/1/attestation.pub.pem (evidence signed).
- Instructions loaded: none.
- Resources: 6 model turn(s); 18658 input and 1165 output token(s) (reported by the runtime); 37 s of inference (13 s reading prompts, 22 s writing replies) and 106 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: none (local runtime).
- Note: Conventions: the approved profile swarm.conventions/v1, sha256 3e7b0ed67bc370f0317c7975f132c9a46adee4613f2b0fec8804247e1eea1fa9, as it stood when the run started.
- Note: Security: ownership applies: the task names a resource that belongs to one user ("authenticated"), and the repository holds an HTTP API (routes in src/server.ts).
- Note: Security: single-use-token does not apply: the task does not name a token, link or code that is redeemed.
- Note: Security: duplicate-operation does not apply: the task does not name an operation that must not be applied twice.
- Note: Security: the security checks' binding was drafted by a model call that read the base and never the change: /Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-invoice-repair-1/home/sessions/20261127T041755-849c93/security.json. It is used as drafted because --accept-authored was passed; nobody reviewed it. To stand behind it, read it and pass it with --security-check.
- Note: Security: the binding, sha256 ee840a07b853a9dc6c3c19d48630b1576c7e7a9b9c148c79c422e577dfab0294, was tried at the base with real requests before the first edit (security-ownership-1: each named user is signed in, and a request without credentials is not: pass; another user is refused: fail; an unauthenticated request is refused: pass; a user of another role is refused: fail; the owner is served: pass).
