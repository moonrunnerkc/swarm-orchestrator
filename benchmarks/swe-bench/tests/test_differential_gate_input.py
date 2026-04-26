"""Tests for SWE-bench layer-1 differential gate input construction."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


_HERE = Path(__file__).resolve().parent
_SCRIPT = _HERE.parent / "evaluation-scripts" / "run_swebench.py"
_SPEC = importlib.util.spec_from_file_location("run_swebench", _SCRIPT)
_module = importlib.util.module_from_spec(_SPEC)
try:
    _SPEC.loader.exec_module(_module)  # type: ignore[union-attr]
except Exception as exc:  # pragma: no cover
    pytest.skip(
        f"run_swebench.py did not import cleanly: {exc}", allow_module_level=True
    )

build_swebench_differential_gate_input = _module.build_swebench_differential_gate_input
perinstance_image = _module.perinstance_image
PERINSTANCE_IMAGE_REGISTRY = _module.PERINSTANCE_IMAGE_REGISTRY


def test_builds_pytest_command_from_fail_to_pass_json_string():
    task = {
        "base_commit": "abc123",
        "FAIL_TO_PASS": json.dumps(["tests/test_calc.py::test_add"]),
        "test_patch": "",
    }

    result = build_swebench_differential_gate_input(
        task,
        agent_branch="swarm/fix",
        python_executable="/tmp/venv/bin/python",
    )

    assert result["ready"] is True
    assert result["base_commit"] == "abc123"
    assert result["agent_branch"] == "swarm/fix"
    assert result["fail_to_pass_ids"] == ["tests/test_calc.py::test_add"]
    assert "/tmp/venv/bin/python -m pytest --tb=short -q tests/test_calc.py::test_add" in (
        result["test_command"]
    )


def test_scopes_bare_fail_to_pass_names_to_test_patch_files():
    task = {
        "base_commit": "abc123",
        "FAIL_TO_PASS": ["test_addition"],
        "test_patch": "diff --git a/tests/test_calc.py b/tests/test_calc.py\n",
    }

    result = build_swebench_differential_gate_input(task)

    assert result["ready"] is True
    assert "tests/test_calc.py" in result["test_command"]
    assert "-k '(test_addition)'" in result["test_command"]


def test_reports_not_ready_without_fail_to_pass():
    result = build_swebench_differential_gate_input({
        "base_commit": "abc123",
        "FAIL_TO_PASS": "",
        "test_patch": "",
    })

    assert result["ready"] is False
    assert result["reason"] == "no FAIL_TO_PASS tests specified"


def test_perinstance_image_uses_resolved_registry_prefix():
    image = perinstance_image("django__django-12345")

    assert image == f"{PERINSTANCE_IMAGE_REGISTRY}.django__django-12345:latest"
