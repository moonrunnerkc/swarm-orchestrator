# swarm run: complete

Task: Accepting an invite must stop working once it has expired. POST /invites/:token/accept answers 410 and adds nobody to the team when more than settings.inviteTtlMs milliseconds have passed since the invite was issued. A valid invite is still accepted with 200, a used one is refused with 409 and an unknown one with 404. Add tests.

Model: gemma4:31b (named by --model). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Witness | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1: Accepting an invite must stop working once it has expired. POST /invites/:token/accept answers 410 and adds nobody to the team when more than settings.inviteTtlMs milliseconds have passed since the invite was issued. A valid invite is still accepted with 200, a used one is refused with 409 and an unknown one with 404. Add tests. | user, required | feature, with no evidence named |  | satisfied | independent | test/invites.swarm-r1.test.ts::a used invite is refused with 409 (preserved, independently-generated); test/invites.swarm-r1.test.ts::an expired invite answers 410 and adds nobody to the team (fixed, independently-generated); test/invites.swarm-r1.test.ts::an unknown invite is refused with 404 (preserved, independently-generated); test/invites.swarm-r1.test.ts::control: a valid invite is still accepted with 200 (preserved, independently-generated); test/expiry.test.ts::an invite expires after settings.inviteTtlMs (witness, implementation-authored) |  |
| R2: A token the task issues is honored once and only while it is valid: an expired, unknown or already used one is refused, and of several redemptions at once exactly one succeeds (its check sends POST /invites/{{token}}/accept and requests like it straight to the server) | security, required | other, with no evidence named |  | satisfied | independent | behavior security-single-use-token-1::a valid token is redeemed (preserved, independently-generated); behavior security-single-use-token-1::a redeemed token is refused (preserved, independently-generated); behavior security-single-use-token-1::a token that was never issued is refused (preserved, independently-generated); behavior security-single-use-token-1::an expired token is refused (fixed, independently-generated); behavior security-single-use-token-1::a token redeemed several times at once is honored once (preserved, independently-generated) |  |

- Independent checks for R1: a test, run from test/invites.swarm-r1.test.ts (read as feature), failing at the base, written without seeing the change.
- Delivered patch: `/Users/brad/projects/recovery-2026-10-31/run-expiry/runs/final-1/home/sessions/20261127T160624-1e140d/final/delivered.patch`, sha256 aaf9c0836c6556ce92936744c29999d683b8a79c425e31c2953286b88cf84bdd, against base 827cc762a8da388ebaad65e53ba417f6359d2a7c.
- Verification of that patch: reused.
- Changed: src/app.ts (modified); src/config.ts (modified); test/expiry.test.ts (added); test/invites.test.ts (modified).
- Starting state: HEAD 827cc762a8da388ebaad65e53ba417f6359d2a7c, no uncommitted edits.
- Applied to the workspace: no, kept as a patch, as asked.
- Regression: none.
- The model's commands: isolated: each command in a container of node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed, only the workspace writable.
- Verification: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared; memory 4096 MiB with no swap and 2 CPUs, per container.
- Attestation: /Users/brad/projects/recovery-2026-10-31/run-expiry/runs/final-1/home/sessions/20261127T160624-1e140d/verifications/3/attestation.sigstore.json, verified with /Users/brad/projects/recovery-2026-10-31/run-expiry/runs/final-1/home/sessions/20261127T160624-1e140d/verifications/3/attestation.pub.pem (evidence signed).
- Instructions loaded: none.
- Resources: 15 model turn(s); 82167 input and 3831 output token(s) (reported by the runtime); 246 s of inference (112 s reading prompts, 128 s writing replies) and 408 s of wall time; 0 retried request(s); 0 escalation(s); 3 verification(s) in the loop; cost: none (local runtime).
- Note: Security: ownership does not apply: excluded by the user (--no-security).
- Note: Security: single-use-token applies: the task names a token, link or code that is redeemed ("invite"), and the repository holds an HTTP API (routes in src/server.ts).
- Note: Security: duplicate-operation does not apply: the task does not name an operation that must not be applied twice.
- Note: Security: the security checks' binding was drafted by a model call that read the base and never the change: /Users/brad/projects/recovery-2026-10-31/run-expiry/runs/final-1/home/sessions/20261127T160624-1e140d/security.json. It is used as drafted because --accept-authored was passed; nobody reviewed it. To stand behind it, read it and pass it with --security-check.
- Note: Security: the binding, sha256 8cc043e2843dfc35e04c954da838093cfaca91acb7cd9071d88540ab7e40a2b5, was tried at the base with real requests before the first edit (security-single-use-token-1: a valid token is redeemed: pass; a redeemed token is refused: pass; a token that was never issued is refused: pass; an expired token is refused: fail; a token redeemed several times at once is honored once: pass).
