"""Regression tests for capture_agent_diff (defect d).

Run:
  python3 -m pytest benchmarks/swe-bench/tests/test_capture_agent_diff.py -v

These are Python tests because the code under test is Python. They are NOT
part of the mocha suite that runs in CI today — wire them into a pytest job
when the SWE-bench container path is built out.
"""
from __future__ import annotations

import importlib.util
import subprocess
import tempfile
from pathlib import Path

import pytest


_HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "run_swebench",
    _HERE.parent / "evaluation-scripts" / "run_swebench.py",
)
_module = importlib.util.module_from_spec(_SPEC)
try:
    _SPEC.loader.exec_module(_module)  # type: ignore[union-attr]
except Exception as exc:  # pragma: no cover - surfaces at collection time
    pytest.skip(f"run_swebench.py did not import cleanly: {exc}", allow_module_level=True)

capture_agent_diff = _module.capture_agent_diff
DiffCaptureError = _module.DiffCaptureError


GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(cwd: Path, *args: str, input: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        env={**GIT_ENV},
        input=input,
        timeout=30,
        check=False,
    )


def _seed_repo(tmp: Path) -> str:
    _git(tmp, "init", "-q")
    _git(tmp, "config", "user.email", "t@t")
    _git(tmp, "config", "user.name", "t")
    (tmp / "README.md").write_text("seed\n")
    _git(tmp, "add", ".")
    _git(tmp, "commit", "-m", "seed")
    return _git(tmp, "rev-parse", "HEAD").stdout.decode().strip()


def test_captures_bytes_even_when_file_content_contains_non_utf8():
    """Regression: the diff contains a file whose bytes don't decode as
    UTF-8. Previously `subprocess.run(..., text=True)` raised
    UnicodeDecodeError; now returns bytes without touching the decoder.
    """
    with tempfile.TemporaryDirectory(prefix="cap-d-") as t:
        tmp = Path(t)
        base_sha = _seed_repo(tmp)

        # Force git to treat the file as text so the diff body includes
        # the raw bytes. Without .gitattributes git could mark it binary
        # and emit only "Binary files a/x and b/x differ" — which is ASCII
        # and wouldn't exercise the decoder path we're testing.
        (tmp / ".gitattributes").write_text("notes.txt text\n")
        bad = tmp / "notes.txt"
        bad.write_bytes(b"hello\n\xd4\xe9\xa0 latin-1 residue\n")
        _git(tmp, "add", ".")
        _git(tmp, "commit", "-m", "add notes with non-utf8")

        out = capture_agent_diff(tmp, base_sha)

        assert isinstance(out, bytes), "must return bytes, not str"
        assert b"notes.txt" in out, "diff should reference the file"
        assert b"\xd4" in out, "raw non-UTF-8 byte should survive through the pipe"


def test_empty_diff_raises_with_actionable_message():
    """An empty diff means the agent made no changes. That's a real failure
    mode (rollback, crash, bad plan) and the caller needs to know about it,
    not silently receive zero bytes.
    """
    with tempfile.TemporaryDirectory(prefix="cap-empty-") as t:
        tmp = Path(t)
        base_sha = _seed_repo(tmp)

        with pytest.raises(DiffCaptureError) as exc_info:
            capture_agent_diff(tmp, base_sha)

        msg = str(exc_info.value).lower()
        assert "empty diff" in msg
        assert base_sha[:12] in str(exc_info.value), "error should name the base commit"


def test_oversized_diff_raises_before_shipping_to_container():
    """A >10 MB diff almost always means the intent-to-add scope pulled in
    noise (build output, vendor trees). Refuse to hand it downstream.
    """
    with tempfile.TemporaryDirectory(prefix="cap-huge-") as t:
        tmp = Path(t)
        base_sha = _seed_repo(tmp)

        # ~14 MB of text — 8 bytes × 2M lines — easily clears the 10 MB gate.
        huge = tmp / "src"
        huge.mkdir()
        (huge / "generated.py").write_text("# line\n" * 2_000_000)
        _git(tmp, "add", ".")
        _git(tmp, "commit", "-m", "generated blob")

        with pytest.raises(DiffCaptureError) as exc_info:
            capture_agent_diff(tmp, base_sha)

        msg = str(exc_info.value)
        assert "10,485,760" in msg, "error should name the ceiling"
        assert "bytes" in msg.lower()
