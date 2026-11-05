# swarm run: complete

Task: is_template in src/skillcheck/template_detection.py reads a real skill as a template when its description has bracketed acronyms such as [ISO], [API] or [CLI], which silently turns off the directory-name, VS Code dirname and description checks for that skill. A literal [...] placeholder must still be read as a template. Fix it, with a test.

Model: gemma4:31b (the best record here: 82% of its finished tasks complete, needs 25.3 GiB at a 65536-token context, 24.1 tok/s in its probe). Stopped: complete.

| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| R1: is_template in src/skillcheck/template_detection.py reads a real skill as a template when its description has bracketed acronyms such as [ISO], [API] or [CLI], which silently turns off the directory-name, VS Code dirname and description checks for that skill. A literal [...] placeholder must still be read as a template. Fix it, with a test. | user | fix: tests tests/test_template_detection_bug.py |  | satisfied | tests.test_template_detection_bug.TestTemplateDetectionBug::test_bracketed_acronyms_are_not_templates (witness, implementation-authored); tests.test_template_detection_bug.TestTemplateDetectionBug::test_placeholders_are_templates (passes before and after, implementation-authored) |  |

- Delivered patch: `/Users/brad/.swarm/sessions/20261105T051546-ae955c/final/delivered.patch`, sha256 345f10899c0297680a293be34e5ad3f6a8eef48b540499a4b8e64cc597229738, against base bb755d22efbfeb771ed7de46ae09e6390b360d7d.
- Verification of that patch: reused.
- Changed: src/skillcheck/template_detection.py (modified); tests/test_template_detection_bug.py (added).
- Starting state: HEAD bb755d22efbfeb771ed7de46ae09e6390b360d7d, no uncommitted edits.
- Python environment: built in the worktree by `uv lock && uv sync --frozen --all-extras`; interpreter /Users/brad/projects/recovery-2026-10-31/run-comparison/p2/fix-tracemantle-f69ad0c58/attempt-1/.tracemantle.swarm-20261105T051546-ae955c/.venv/bin/python, Python 3.13.13.
- Applied to the workspace: yes.
- Regression: none (1 inherited failure(s)).
- Execution: isolated: docker ghcr.io/astral-sh/uv:python3.12-bookworm@sha256:85d4cb1afa769a7338e095b927bee941cf5ec92266c7424b3f6c0f2748567248, network closed for checks and open only while dependencies were prepared.
- Attestation: /Users/brad/.swarm/sessions/20261105T051546-ae955c/verifications/2/attestation.sigstore.json.
- Instructions loaded: none.
- Resources: 21 model turn(s); 88491 input and 2504 output token(s) (reported by the runtime); 272 s of inference and 918 s of wall time; 0 retried request(s); 0 escalation(s); 2 verification(s) in the loop; cost: none (local runtime).
