"""Behavioral tests for the --keep-workdir flag (PR 3).

Verify that:
  1. Without the flag, the workspace directory is removed after evaluate_tasks returns.
  2. With the flag, the workspace directory survives on disk after the call.

These tests mock the inner loop so no network I/O or agent invocation occurs.

Run:
  python3 -m pytest benchmarks/swe-bench/tests/test_keep_workdir.py -v
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "run_swebench",
    _HERE.parent / "evaluation-scripts" / "run_swebench.py",
)
_module = importlib.util.module_from_spec(_SPEC)
try:
    _SPEC.loader.exec_module(_module)  # type: ignore[union-attr]
except Exception as exc:  # pragma: no cover
    pytest.skip(
        f"run_swebench.py did not import cleanly: {exc}", allow_module_level=True
    )

evaluate_tasks = _module.evaluate_tasks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_TASK = {
    "instance_id": "test__repo-1",
    "repo": "test/repo",
    "base_commit": "abc123def456",
    "problem_statement": "Fix the bug.",
    "hints_text": "",
    "created_at": "2024-01-01T00:00:00Z",
    "version": "1.0",
    "FAIL_TO_PASS": "[]",
    "PASS_TO_PASS": "[]",
    "environment_setup_commit": "abc123def456",
}

_FAKE_RUN = {"elapsed_seconds": 1.0, "returncode": 0, "stdout": "", "stderr": ""}
_FAKE_TEST = {"passed": False, "reason": "test_stub"}


def _make_mocks(captured_workdir: list[Path]):
    """Return a dict of patches that capture the workdir path without doing any I/O."""

    def fake_load_tasks():
        return [_FAKE_TASK]

    def fake_checkout_repo(task, workdir):
        repo_dir = workdir / task["instance_id"]
        repo_dir.mkdir(parents=True, exist_ok=True)
        # Record the workdir so tests can check whether it survived.
        captured_workdir.append(workdir)
        return repo_dir

    def fake_run_orchestrator(repo_dir, problem_statement):
        return _FAKE_RUN

    def fake_run_tests_dispatch(task, repo_dir):
        return _FAKE_TEST

    def fake_json_dump(obj, fp, **kwargs):
        pass

    return {
        "run_swebench.load_tasks": fake_load_tasks,
        "run_swebench.checkout_repo": fake_checkout_repo,
        "run_swebench.run_orchestrator": fake_run_orchestrator,
        "run_swebench.run_tests_dispatch": fake_run_tests_dispatch,
        "run_swebench.RESULTS_DIR": Path("/tmp"),
        # Prevent actually writing a results JSON.
        "json.dump": fake_json_dump,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_workdir_cleaned_up_by_default():
    """Without --keep-workdir, the workspace directory is removed after the run."""
    captured: list[Path] = []
    patches = _make_mocks(captured)

    with (
        patch.object(_module, "load_tasks", patches["run_swebench.load_tasks"]),
        patch.object(_module, "checkout_repo", patches["run_swebench.checkout_repo"]),
        patch.object(_module, "run_orchestrator", patches["run_swebench.run_orchestrator"]),
        patch.object(_module, "run_tests_dispatch", patches["run_swebench.run_tests_dispatch"]),
        patch.object(_module, "RESULTS_DIR", Path("/tmp")),
        patch("json.dump", patches["json.dump"]),
    ):
        evaluate_tasks(keep_workdir=False)

    assert len(captured) == 1, "checkout_repo should have been called once"
    workdir = captured[0]
    assert not workdir.exists(), (
        f"Workdir {workdir} should have been deleted when keep_workdir=False"
    )


def test_workdir_preserved_with_flag(capsys):
    """With keep_workdir=True, the workspace directory survives and its path is printed."""
    captured: list[Path] = []
    patches = _make_mocks(captured)

    try:
        with (
            patch.object(_module, "load_tasks", patches["run_swebench.load_tasks"]),
            patch.object(_module, "checkout_repo", patches["run_swebench.checkout_repo"]),
            patch.object(_module, "run_orchestrator", patches["run_swebench.run_orchestrator"]),
            patch.object(_module, "run_tests_dispatch", patches["run_swebench.run_tests_dispatch"]),
            patch.object(_module, "RESULTS_DIR", Path("/tmp")),
            patch("json.dump", patches["json.dump"]),
        ):
            evaluate_tasks(keep_workdir=True)

        assert len(captured) == 1, "checkout_repo should have been called once"
        workdir = captured[0]
        assert workdir.exists(), (
            f"Workdir {workdir} should have been preserved when keep_workdir=True"
        )

        out = capsys.readouterr().out
        assert str(workdir) in out, (
            "The preserved workspace path should be printed to stdout"
        )
    finally:
        # Clean up the preserved workdir so the test doesn't litter.
        if captured and captured[0].exists():
            import shutil
            shutil.rmtree(captured[0], ignore_errors=True)
