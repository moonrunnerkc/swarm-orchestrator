# swarm run: incomplete

Task: generateUlid() in packages/core/src/events/ids.ts is meant to put the creation time in a ULID's first 48 bits, but the ids it generates decode to random times (ulidToTime gives anything from 1970 to the year 10888), so event ids do not sort in creation order. Make generated ULIDs carry the current time in their timestamp prefix, keep setFixedUlidSeed deterministic, and add a test.

Model: gemma4:31b, then escalated (the best record here: 80% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: no-progress, the same command printed the same result 3 turns running.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: generateUlid() in packages/core/src/events/ids.ts is meant to put the creation time in a ULID's first 48 bits, but the ids it generates decode to random times (ulidToTime gives anything from 1970 to the year 10888), so event ids do not sort in creation order. Make generated ULIDs carry the current time in their timestamp prefix, keep setFixedUlidSeed deterministic, and add a test. | user | fix: tests ULID generation > should generate ULIDs with current timestamp |  | satisfied | packages/core/test/ids.test.ts::ULID generation > should generate ULIDs with current timestamp (witness, implementation-authored) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261103T012746-36fbbf/final/delivered.patch`, sha256 d0ca3d293893e7f91a4192a62311c4a10b2ec39df666e46194ba734ff92ab00c, against base 3429b76176a8516d421738b29c1bc4c87545b08a.
- Verification of that patch: reused.
- Changed: packages/core/src/events/ids.ts (modified); packages/core/test/ids.test.ts (added).
- Starting state: HEAD 3429b76176a8516d421738b29c1bc4c87545b08a, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: unresolved (16 inherited failure(s)).
- Execution: isolated: docker node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261103T012746-36fbbf/verifications/3/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 24 model turn(s); 132103 input and 4844 output token(s) (reported by the runtime); 446 s of inference and 568 s of wall time; 0 retried request(s); 1 escalation(s); 2 verification(s) in the loop; cost: none (local runtime).
