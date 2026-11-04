# swarm run: complete

Task: is_template in src/skillcheck/template_detection.py reads a real skill as a template when its description has bracketed acronyms such as [ISO], [API] or [CLI], which silently turns off the directory-name, VS Code dirname and description checks for that skill. A literal [...] placeholder must still be read as a template. Fix it, with a test.

Model: gemma4:31b (the best record here: 75% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: is_template in src/skillcheck/template_detection.py reads a real skill as a template when its description has bracketed acronyms such as [ISO], [API] or [CLI], which silently turns off the directory-name, VS Code dirname and description checks for that skill. A literal [...] placeholder must still be read as a template. Fix it, with a test. | user | fix: tests test_is_template_with_acronyms |  | satisfied | tests.test_template_detection::test_is_template_with_acronyms (witness, implementation-authored) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261104T043531-a99a49/final/delivered.patch`, sha256 6b912e0fa025baa04ee9c50af0c55c6ea950719e580f97a0ae1d13edca376df0, against base c37c9d6164e7eff2c57e4d6c819475235b99b1cc.
- Verification of that patch: reused.
- Changed: src/skillcheck/template_detection.py (modified); tests/test_template_detection.py (added).
- Starting state: HEAD c37c9d6164e7eff2c57e4d6c819475235b99b1cc, no uncommitted edits.
- Python environment: built in the worktree by `uv lock && uv sync --frozen --all-extras`; interpreter /Users/brad/projects/recovery-2026-10-31/run-16.0.2/fix-tracemantle-f69ad0c58/attempt-1/.tracemantle.swarm-20261104T043531-a99a49/.venv/bin/python, Python 3.13.13.
- Applied to the workspace: yes.
- Regression: none (100 inherited failure(s)).
- Execution: isolated: docker ghcr.io/astral-sh/uv:python3.12-bookworm@sha256:85d4cb1afa769a7338e095b927bee941cf5ec92266c7424b3f6c0f2748567248, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261104T043531-a99a49/verifications/1/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 20 model turn(s); 121792 input and 2988 output token(s) (reported by the runtime); 387 s of inference and 821 s of wall time; 0 retried request(s); 0 escalation(s); 1 verification(s) in the loop; cost: none (local runtime).
