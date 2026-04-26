"""Tests for direct-agent SWE-bench baseline command construction."""
from __future__ import annotations

import importlib.util
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


def test_builds_copilot_baseline_command(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_module, "SWARM_TOOL", "copilot")

    command, stdin_text = _module.build_baseline_command(Path("/repo"), "issue text")

    assert command[:2] == ["copilot", "-p"]
    assert "issue text" in command[2]
    assert "--allow-all" in command
    assert stdin_text is None


def test_builds_claude_code_baseline_command_with_stdin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_module, "SWARM_TOOL", "claude-code")

    command, stdin_text = _module.build_baseline_command(Path("/repo"), "issue text")

    assert command == ["claude", "--dangerously-skip-permissions", "-p", "-"]
    assert stdin_text is not None
    assert "issue text" in stdin_text


def test_builds_codex_baseline_command_with_workdir(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_module, "SWARM_TOOL", "codex")

    command, stdin_text = _module.build_baseline_command(Path("/repo"), "issue text")

    assert command[:3] == ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox"]
    assert "-C" in command
    assert "/repo" in command
    assert "issue text" in command[-1]
    assert stdin_text is None


def test_rejects_unknown_baseline_tool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(_module, "SWARM_TOOL", "unknown")

    with pytest.raises(ValueError, match="unsupported SWARM_TOOL"):
        _module.build_baseline_command(Path("/repo"), "issue text")
