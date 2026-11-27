# swarm run: incomplete

Task: Add DELETE /notes/:slug: the account that owns the note deletes it and gets 204; any other account gets 404.

Model: gemma4:31b (named by --model). Stopped: no-progress, the task was marked complete again with no change since the last verification.

| Requirement | Source | Read as | Held to | Status | Witness | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1: Add DELETE /notes/:slug: the account that owns the note deletes it and gets 204; any other account gets 404. | user, required | feature: tests an account deletes its own note |  | satisfied | independent | spec/notes.test.ts::an account deletes its own note (witness, implementation-authored); spec/notes.swarm-r1.test.ts::any other account gets 404 when deleting a note they do not own (preserved, independently-generated); spec/notes.swarm-r1.test.ts::control: an account can list its own notes (preserved, independently-generated); spec/notes.swarm-r1.test.ts::the account that owns the note deletes it and gets 204 (fixed, independently-generated) |  |
| R2: The files the change adds or edits follow the approved coding conventions: exports named, function-names camelCase, variable-names camelCase, type-names PascalCase, file-names kebab-case, explicit-any forbidden, exported-return-types explicit, exported-docs documented | profile, required | other, with no evidence named |  | satisfied | independent | exports: named (observed, user-acceptance); function-names: camelCase (observed, user-acceptance); variable-names: camelCase (observed, user-acceptance); type-names: PascalCase (observed, user-acceptance); file-names: kebab-case (observed, user-acceptance); explicit-any: forbidden (observed, user-acceptance); exported-return-types: explicit (observed, user-acceptance); exported-docs: documented (observed, user-acceptance) |  |
| R3: Only its owner can reach the resource the task serves: another user, another role and an unauthenticated request are refused by the server, and the owner is still served | security, required | other, with no evidence named |  | unverified | none | none | no executed evidence is mapped to this requirement |

- Independent checks for R1: a test, run from spec/notes.swarm-r1.test.ts (read as feature), failing at the base, written without seeing the change.
- Delivered patch: `/Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-notes-feature-2/home/sessions/20261127T045952-14fee6/final/delivered.patch`, sha256 b221c12a9881db0c3728974225b20429b277fccd053df0d096d9a17cf28c1af3, against base e9d9f5cf8b31d717899a74132e9bce03bb25d2f5.
- Verification of that patch: reused.
- Changed: service/http.ts (modified); spec/notes.test.ts (modified).
- Starting state: HEAD e9d9f5cf8b31d717899a74132e9bce03bb25d2f5, no uncommitted edits.
- Applied to the workspace: no, kept as a patch, as asked.
- Regression: none.
- The model's commands: isolated: each command in a container of node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed, only the workspace writable.
- Verification: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared; memory 4096 MiB with no swap and 2 CPUs, per container.
- Attestation: /Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-notes-feature-2/home/sessions/20261127T045952-14fee6/verifications/3/attestation.sigstore.json, verified with /Users/brad/projects/recovery-2026-10-31/run-closeout/runs/dev-notes-feature-2/home/sessions/20261127T045952-14fee6/verifications/3/attestation.pub.pem (evidence signed).
- Instructions loaded: none.
- Resources: 10 model turn(s); 40622 input and 2485 output token(s) (reported by the runtime); 130 s of inference (45 s reading prompts, 81 s writing replies) and 250 s of wall time; 0 retried request(s); 0 escalation(s); 3 verification(s) in the loop; cost: none (local runtime).
- Note: Conventions: the approved profile swarm.conventions/v1, sha256 3e7b0ed67bc370f0317c7975f132c9a46adee4613f2b0fec8804247e1eea1fa9, as it stood when the run started.
- Note: Security: ownership applies: the task names a resource that belongs to one user ("owns"), and the repository holds an HTTP API (routes in service/http.ts).
- Note: Security: single-use-token does not apply: the task does not name a token, link or code that is redeemed.
- Note: Security: duplicate-operation does not apply: the task does not name an operation that must not be applied twice.
- Note: Security: no usable check could be drafted (at the base, the users it names did not check out: step 3 (GET /ready): expected status 401 or 403, got 200 ({"ready":true})), so ownership stays unverified. Supply the binding with --security-check <file>.
