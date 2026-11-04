# swarm run: incomplete

Task: When a test file cannot load (a missing dependency, a transform or a config error), runVitest in src/adapters/vitest-run.ts returns no outcomes, and the pipeline reads that empty set as passes-on-head, so ClaimCheck gives a PASS built on a suite that never ran. runVitest should report such a run as failedToRun (and not passed), and the pipeline should not count it as passing on head; add a test.

Model: gemma4:31b (the best record here: 83% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: step-budget.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: When a test file cannot load (a missing dependency, a transform or a config error), runVitest in src/adapters/vitest-run.ts returns no outcomes, and the pipeline reads that empty set as passes-on-head, so ClaimCheck gives a PASS built on a suite that never ran. runVitest should report such a run as failedToRun (and not passed), and the pipeline should not count it as passing on head; add a test. | user | fix: tests runVitest > reports failedToRun when vitest exits with error and no results file is created |  | satisfied | src/adapters/vitest-run.test.ts::runVitest > reports failedToRun when vitest exits with error and no results file is created (witness, implementation-authored) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261103T222355-8f8758/final/delivered.patch`, sha256 7fe0c8677f14e20d69b7ce6df841a46d8ba85570f5bbd87ca53843e63aeef855, against base 8efdaa0363b522dc1064e8ae72c0e3c18f2ff6c5.
- Verification of that patch: fresh.
- Changed: src/adapters/vitest-run.test.ts (added); src/adapters/vitest-run.ts (modified); src/determinism/flake-fallback.ts (modified).
- Starting state: HEAD 8efdaa0363b522dc1064e8ae72c0e3c18f2ff6c5, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: unresolved (4 inherited failure(s)).
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261103T222355-8f8758/final/verification/attestation.sigstore.json.
- Instructions loaded: CLAUDE.md (sha256 1716f7588a3792287041ff8a72700c5008c773dba9b71b6810f4429f3022a221).
- Resources: 60 model turn(s); 678379 input and 14386 output token(s) (reported by the runtime); 2191 s of inference and 2339 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: none (local runtime).
- Note: the last verification described an earlier tree or record, so the delivered one was verified again
