# swarm run: incomplete

Task: generateUlid() in packages/core/src/events/ids.ts is meant to put the creation time in a ULID's first 48 bits, but the ids it generates decode to random times (ulidToTime gives anything from 1970 to the year 10888), so event ids do not sort in creation order. Make generated ULIDs carry the current time in their timestamp prefix, keep setFixedUlidSeed deterministic, and add a test.

Model: gemma4:31b, then escalated (the best record here: 83% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: no-progress, the same command printed the same result 3 turns running.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: generateUlid() in packages/core/src/events/ids.ts is meant to put the creation time in a ULID's first 48 bits, but the ids it generates decode to random times (ulidToTime gives anything from 1970 to the year 10888), so event ids do not sort in creation order. Make generated ULIDs carry the current time in their timestamp prefix, keep setFixedUlidSeed deterministic, and add a test. | user | fix: tests ULID generation > should generate ULIDs with current timestamp, ULID generation > should sort in creation order, ULID generation > should be deterministic when fixed seed is set |  | satisfied | packages/core/test/ids.test.ts::ULID generation > should generate ULIDs with current timestamp (witness, implementation-authored); packages/core/test/ids.test.ts::ULID generation > should sort in creation order (witness, implementation-authored); packages/core/test/ids.test.ts::ULID generation > should be deterministic when fixed seed is set (passes before and after, implementation-authored) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261103T221128-fcb79f/final/delivered.patch`, sha256 5d4c41b1e80cb2fb77fde2e9bae9df5b18257f0abb5de97dda441ad2c214b267, against base 3429b76176a8516d421738b29c1bc4c87545b08a.
- Verification of that patch: reused.
- Changed: packages/core/src/events/ids.ts (modified); packages/core/test/ids.test.ts (added).
- Starting state: HEAD 3429b76176a8516d421738b29c1bc4c87545b08a, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: unresolved (16 inherited failure(s)).
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261103T221128-fcb79f/verifications/2/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 28 model turn(s); 189098 input and 1902 output token(s) (reported by the runtime); 431 s of inference and 554 s of wall time; 0 retried request(s); 1 escalation(s); 2 verification(s) in the loop; cost: none (local runtime).
