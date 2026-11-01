# swarm run: complete

Task: Move Severity, Finding and PromotionReport from src/ironroot/cli/promote.py into cli/promote_report.py and re-export them from promote.py.

Model: swarm-redesign-qwen36-32k:latest (conservative default: the largest installed model that fits and passed its readiness probe, needs 27.2 GiB at a 65536-token context, 121.6 tok/s in its probe; no finished tasks recorded for it here yet). Stopped: complete.

| Requirement | Kind | Source | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| R1: Move Severity, Finding and PromotionReport from src/ironroot/cli/promote.py into cli/promote_report.py and re-export them from promote.py. | refactor | user | satisfied | src/ironroot/cli/promote.py, src/ironroot/cli/promote_report.py (observed, pre-existing) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261101T054940-b71a2a/final/delivered.patch`, sha256 2b70f1fea86e9c2ebbd53e250886529063530c3a8e3bbba18db1fc016dea4d07, against base 1d325c297757e83f048be593b59cfda7681a5448.
- Verification of that patch: reused.
- Starting state: HEAD 1d325c297757e83f048be593b59cfda7681a5448, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: none.
- Execution: isolated: docker ghcr.io/astral-sh/uv:python3.12-bookworm@sha256:85d4cb1afa769a7338e095b927bee941cf5ec92266c7424b3f6c0f2748567248, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261101T054940-b71a2a/verifications/1/attestation.sigstore.json.
- Instructions loaded: CLAUDE.md (sha256 ed6eeb9c65511c2f23fcaf1a57177860324b6f0203054fb483758a70ceaa41d9).
- Resources: 39 model turn(s); 735845 input and 7243 output token(s) (reported by the runtime); 84 s of inference and 224 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: none (local runtime).
