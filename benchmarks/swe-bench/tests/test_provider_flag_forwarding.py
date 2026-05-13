"""Behavioral tests for the provider flag forwarding added in C2.

Verify that:
  1. `build_provider_flags()` returns an empty list when nothing is set.
  2. CLI args populate `_PROVIDER_FLAGS` and propagate to the flag list.
  3. `run_orchestrator()`'s subprocess command includes the provider flags.
  4. `--compare-providers` mode runs the sweep once per provider and writes
     a comparison JSON keyed by instance_id.

Run:
  python3 -m pytest benchmarks/swe-bench/tests/test_provider_flag_forwarding.py -v
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_HERE = Path(__file__).resolve().parent


def _import_run_swebench():
    """Load run_swebench.py with the heavy `datasets`/`tqdm` imports stubbed.

    The harness's actual runtime path needs HuggingFace's `datasets` and
    `tqdm`. The unit tests below stub the orchestrator invocation and
    never reach load_tasks(), so a lightweight fake is sufficient and
    keeps the tests runnable in environments that don't have those deps.
    """
    stubs: dict[str, MagicMock] = {}
    for name in ("datasets", "tqdm"):
        if name not in sys.modules:
            stubs[name] = MagicMock()
            sys.modules[name] = stubs[name]
    if "datasets" in stubs:
        stubs["datasets"].load_dataset = MagicMock(return_value=[])
    if "tqdm" in stubs:
        stubs["tqdm"].tqdm = lambda x, **_kw: x
    spec = importlib.util.spec_from_file_location(
        "run_swebench",
        _HERE.parent / "evaluation-scripts" / "run_swebench.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


try:
    _module = _import_run_swebench()
except Exception as exc:  # pragma: no cover
    pytest.skip(
        f"run_swebench.py did not import cleanly: {exc}", allow_module_level=True
    )


# ---------------------------------------------------------------------------
# build_provider_flags()
# ---------------------------------------------------------------------------


def test_build_provider_flags_empty_by_default(monkeypatch):
    """With every provider key unset, the flag list is empty."""
    snapshot = dict(_module._PROVIDER_FLAGS)
    try:
        for k in list(_module._PROVIDER_FLAGS.keys()):
            _module._PROVIDER_FLAGS[k] = None
        assert _module.build_provider_flags() == []
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)


def test_build_provider_flags_emits_extractor_and_local_keys():
    """CLI-shaped flag pairs come out in the order the dict iterates."""
    snapshot = dict(_module._PROVIDER_FLAGS)
    try:
        for k in list(_module._PROVIDER_FLAGS.keys()):
            _module._PROVIDER_FLAGS[k] = None
        _module._PROVIDER_FLAGS["--extractor"] = "local"
        _module._PROVIDER_FLAGS["--session"] = "local"
        _module._PROVIDER_FLAGS["--local-backend"] = "ollama"
        _module._PROVIDER_FLAGS["--local-base-url"] = "http://localhost:11434"
        out = _module.build_provider_flags()
        assert "--extractor" in out
        assert out[out.index("--extractor") + 1] == "local"
        assert "--session" in out
        assert out[out.index("--session") + 1] == "local"
        assert "--local-backend" in out
        assert out[out.index("--local-backend") + 1] == "ollama"
        assert "--local-base-url" in out
        assert out[out.index("--local-base-url") + 1] == "http://localhost:11434"
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)


# ---------------------------------------------------------------------------
# _apply_provider_args()
# ---------------------------------------------------------------------------


def test_apply_provider_args_overrides_env_derived_defaults():
    """CLI values win over the env-var defaults the module dict was seeded with."""
    snapshot = dict(_module._PROVIDER_FLAGS)
    try:
        for k in list(_module._PROVIDER_FLAGS.keys()):
            _module._PROVIDER_FLAGS[k] = None

        ns = argparse.Namespace(
            extractor="deterministic",
            session="local",
            local_backend="vllm",
            local_base_url="http://vllm.local:8000",
            local_model_extractor=None,
            local_model_session="qwen2.5-coder:32b",
            local_persona_model_map=None,
            local_grammar="json-schema",
            local_request_timeout_ms=None,
            local_max_concurrency=None,
            local_api_key=None,
            local_seed=None,
        )
        _module._apply_provider_args(ns)
        assert _module._PROVIDER_FLAGS["--extractor"] == "deterministic"
        assert _module._PROVIDER_FLAGS["--session"] == "local"
        assert _module._PROVIDER_FLAGS["--local-backend"] == "vllm"
        assert _module._PROVIDER_FLAGS["--local-base-url"] == "http://vllm.local:8000"
        assert _module._PROVIDER_FLAGS["--local-model-extractor"] is None
        assert _module._PROVIDER_FLAGS["--local-model-session"] == "qwen2.5-coder:32b"
        assert _module._PROVIDER_FLAGS["--local-grammar"] == "json-schema"
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)


# ---------------------------------------------------------------------------
# run_orchestrator() splices provider flags into the subprocess command
# ---------------------------------------------------------------------------


def test_run_orchestrator_forwards_provider_flags_to_subprocess(tmp_path):
    """The cmd argv passed to subprocess.run contains every set provider flag."""
    snapshot = dict(_module._PROVIDER_FLAGS)
    try:
        for k in list(_module._PROVIDER_FLAGS.keys()):
            _module._PROVIDER_FLAGS[k] = None
        _module._PROVIDER_FLAGS["--extractor"] = "deterministic"
        _module._PROVIDER_FLAGS["--session"] = "deterministic"
        _module._PROVIDER_FLAGS["--local-backend"] = "ollama"

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            result = MagicMock()
            result.returncode = 0
            result.stdout = ""
            result.stderr = ""
            return result

        with (
            patch.object(_module.subprocess, "run", side_effect=fake_run),
            patch.object(_module, "BASELINE_MODE", False),
            patch.object(_module, "find_fatal_run_sentinel", lambda _r: None),
        ):
            _module.run_orchestrator(tmp_path, "fix a thing", task=None)

        cmd = captured["cmd"]
        assert "--extractor" in cmd
        assert cmd[cmd.index("--extractor") + 1] == "deterministic"
        assert "--session" in cmd
        assert cmd[cmd.index("--session") + 1] == "deterministic"
        assert "--local-backend" in cmd
        assert cmd[cmd.index("--local-backend") + 1] == "ollama"
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)


def test_run_orchestrator_omits_unset_provider_flags(tmp_path):
    """No CLI flags appear when nothing in _PROVIDER_FLAGS is set."""
    snapshot = dict(_module._PROVIDER_FLAGS)
    try:
        for k in list(_module._PROVIDER_FLAGS.keys()):
            _module._PROVIDER_FLAGS[k] = None

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            result = MagicMock()
            result.returncode = 0
            result.stdout = ""
            result.stderr = ""
            return result

        with (
            patch.object(_module.subprocess, "run", side_effect=fake_run),
            patch.object(_module, "BASELINE_MODE", False),
            patch.object(_module, "find_fatal_run_sentinel", lambda _r: None),
        ):
            _module.run_orchestrator(tmp_path, "fix a thing", task=None)

        cmd = captured["cmd"]
        assert "--extractor" not in cmd
        assert "--session" not in cmd
        for f in _module._LOCAL_PROVIDER_FLAGS:
            assert f not in cmd, f"unexpected provider flag {f} in default cmd"
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)


# ---------------------------------------------------------------------------
# --compare-providers mode
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


def test_compare_providers_writes_three_provider_summary(tmp_path, monkeypatch):
    """One sweep per provider; comparison JSON pivots per instance_id."""

    monkeypatch.setattr(_module, "RESULTS_DIR", tmp_path)

    snapshot = dict(_module._PROVIDER_FLAGS)
    try:

        seen_extractor: list[str | None] = []

        def fake_evaluate_tasks(*, keep_workdir=False):  # noqa: ARG001
            seen_extractor.append(_module._PROVIDER_FLAGS["--extractor"])
            return {
                "resolved": 1 if seen_extractor[-1] == "anthropic" else 0,
                "total": 1,
                "percent_resolved": 100.0 if seen_extractor[-1] == "anthropic" else 0.0,
                "mean_latency_seconds": 2.5,
                "tasks": [
                    {
                        "instance_id": _FAKE_TASK["instance_id"],
                        "resolved": seen_extractor[-1] == "anthropic",
                        "run": {"elapsed_seconds": 2.5},
                        "status": "ok",
                    }
                ],
            }

        with patch.object(_module, "evaluate_tasks", side_effect=fake_evaluate_tasks):
            summary = _module.evaluate_tasks_compare_providers(keep_workdir=False)

        # Each provider's evaluate_tasks() saw the corresponding extractor.
        assert seen_extractor == ["deterministic", "local", "anthropic"]
        # Comparison JSON shape.
        assert set(summary["providers"]) == {"deterministic", "local", "anthropic"}
        assert summary["summary"]["anthropic"]["resolved"] == 1
        assert summary["summary"]["deterministic"]["resolved"] == 0
        # Per-instance pivot.
        rows = summary["per_instance"]
        assert len(rows) == 1
        row = rows[0]
        assert row["instance_id"] == _FAKE_TASK["instance_id"]
        assert row["anthropic"]["resolved"] is True
        assert row["deterministic"]["resolved"] is False
        assert row["local"]["resolved"] is False
        # File written to RESULTS_DIR.
        out = list(tmp_path.glob("*-compare-providers.json"))
        assert out, "compare-providers JSON not written"
        loaded = json.loads(out[0].read_text())
        assert loaded["providers"] == list(summary["providers"])
    finally:
        _module._PROVIDER_FLAGS.clear()
        _module._PROVIDER_FLAGS.update(snapshot)
