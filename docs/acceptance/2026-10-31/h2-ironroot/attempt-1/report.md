# swarm run: incomplete

Task: _scan_for_patterns in cli/promote.py strips multi-line docstrings including their newlines, so reported line numbers after a docstring are wrong; keep the newlines, with a test.

Model: gemma4-31b-greedy-128k:latest (the best record here: 67% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 23.8 tok/s in its probe). Stopped: time-budget, the time left is reserved for final verification.

| Requirement | Kind | Source | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| R1: _scan_for_patterns in cli/promote.py strips multi-line docstrings including their newlines, so reported line numbers after a docstring are wrong; keep the newlines, with a test. | other | user | unverified | none | no executed evidence is mapped to this requirement |

- Delivered patch: `/Users/brad/.swarm/sessions/20261101T105145-405d94/final/delivered.patch`, sha256 e79b05c2509d9180256f23cc27b26f044953f65c4cba2b0219668beba62bdaf9, against base 1d325c297757e83f048be593b59cfda7681a5448.
- Verification of that patch: fresh.
- Changed: src/ironroot/cli/promote.py (modified); tests/integrity/test_promote_scan.py (added).
- Starting state: HEAD 1d325c297757e83f048be593b59cfda7681a5448, no uncommitted edits.
- Applied to the workspace: yes.
- Regression: found.
- Execution: isolated: docker ghcr.io/astral-sh/uv:python3.12-bookworm@sha256:85d4cb1afa769a7338e095b927bee941cf5ec92266c7424b3f6c0f2748567248, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261101T105145-405d94/final/verification/attestation.sigstore.json.
- Instructions loaded: CLAUDE.md (sha256 ed6eeb9c65511c2f23fcaf1a57177860324b6f0203054fb483758a70ceaa41d9).
- Resources: 35 model turn(s); 746958 input and 50792 output token(s) (reported by the runtime); 3509 s of inference and 3648 s of wall time; 0 retried request(s); 0 escalation(s); 0 verification(s) in the loop; cost: none (local runtime).
