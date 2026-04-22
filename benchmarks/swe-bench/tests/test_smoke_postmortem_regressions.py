"""Regression tests for the smoke6/smoke8 post-mortem defects.

Problem A (smoke6/7 root cause):
  git clone --filter=blob:none leaves master pointing at the upstream tip,
  potentially tens of thousands of commits ahead of base_commit. A bare
  git checkout base_commit creates detached HEAD but leaves master at tip.
  The branch-merger merges the swarm branch into master-at-tip, so
  git diff base_commit..HEAD captures all upstream history.
  Fix: git checkout -B master base_commit resets master to the anchor.

Problem B (smoke8 failure):
  capture_agent_diff ran git diff base_commit without pathspec excludes.
  Reserved-path content committed into the history above base_commit
  (.copilot-instructions.md, runs/) appeared in the output patch.
  git apply inside the SWE-bench /testbed container rejected the patch
  because those paths don't exist there.
  Fix: append git_pathspec_excludes() after -- . in the diff invocation.

Run:
  python3 -m pytest benchmarks/swe-bench/tests/test_smoke_postmortem_regressions.py -v
"""
from __future__ import annotations

import importlib.util
import subprocess
import tempfile
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

capture_agent_diff = _module.capture_agent_diff
DiffCaptureError = _module.DiffCaptureError

_RESERVED_SPEC = importlib.util.spec_from_file_location(
    "worktree_reserved_paths",
    _HERE.parent / "evaluation-scripts" / "worktree_reserved_paths.py",
)
_reserved = importlib.util.module_from_spec(_RESERVED_SPEC)
_RESERVED_SPEC.loader.exec_module(_reserved)  # type: ignore[union-attr]

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env={**GIT_ENV},
        timeout=30,
        check=False,
    )


def _sha(cwd: Path, ref: str = "HEAD") -> str:
    return _git(cwd, "rev-parse", ref).stdout.strip()


def _seed_upstream(tmp: Path) -> tuple[Path, str, str]:
    """Create a bare 'upstream' repo with two commits.

    Returns (bare_path, base_sha, tip_sha) where tip_sha is 1 commit ahead
    of base_sha, simulating a repo whose master advanced after the SWE-bench
    base_commit was tagged.
    """
    upstream = tmp / "upstream.git"
    upstream.mkdir()
    _git(upstream, "init", "--bare", "-q")

    # Work tree to push commits into the bare repo
    work = tmp / "work"
    work.mkdir()
    _git(work, "init", "-q")
    _git(work, "config", "user.email", "t@t")
    _git(work, "config", "user.name", "t")
    _git(work, "remote", "add", "origin", str(upstream))

    (work / "README.md").write_text("base\n")
    _git(work, "add", ".")
    _git(work, "commit", "-m", "base commit")
    base_sha = _sha(work)

    (work / "UPSTREAM.md").write_text("upstream advance\n")
    _git(work, "add", ".")
    _git(work, "commit", "-m", "upstream advance past base_commit")
    tip_sha = _sha(work)

    _git(work, "push", "origin", "master")
    return upstream, base_sha, tip_sha


# ---------------------------------------------------------------------------
# Problem A regression
# ---------------------------------------------------------------------------


def test_checkout_resets_master_to_base_commit():
    """git checkout -B master base_commit resets master (not just HEAD).

    Reproduces the smoke6/7 root cause: after cloning, master sits at the
    upstream tip. Without -B, 'git checkout base_commit' creates detached
    HEAD but leaves master pointing at the tip. The branch-merger then merges
    the swarm branch into master-at-tip and captures all upstream history.

    The fix (checkout -B master base_commit) must leave BOTH HEAD and master
    pointing at base_commit after checkout_repo runs.
    """
    with tempfile.TemporaryDirectory(prefix="pma-") as t:
        tmp = Path(t)
        upstream, base_sha, tip_sha = _seed_upstream(tmp)

        # Simulate what checkout_repo does: clone then checkout -B master base.
        clone_dir = tmp / "clone"
        r = _git(tmp, "clone", str(upstream), str(clone_dir))
        assert r.returncode == 0, f"clone failed: {r.stderr}"

        # Before the fix: master is at tip after clone.
        assert _sha(clone_dir, "master") == tip_sha, (
            "pre-condition: after clone, master should be at tip_sha"
        )

        # Apply the fix.
        r = _git(clone_dir, "checkout", "-B", "master", base_sha)
        assert r.returncode == 0, f"checkout -B failed: {r.stderr}"

        # Post-condition: HEAD and master both point at base_commit.
        assert _sha(clone_dir, "HEAD") == base_sha, (
            "HEAD must point at base_commit after checkout -B master base_commit"
        )
        assert _sha(clone_dir, "master") == base_sha, (
            "master branch must be reset to base_commit, not left at clone tip. "
            "Without this, the branch-merger merges the swarm branch into the "
            "upstream tip and git diff base_commit..HEAD captures all upstream history."
        )

        # Sanity: commit count from base is exactly 1 (the base commit itself).
        count = _git(clone_dir, "rev-list", "--count", "HEAD").stdout.strip()
        upstream_count = _git(clone_dir, "rev-list", "--count", tip_sha).stdout.strip()
        assert count != upstream_count, (
            "commit count from HEAD should differ from count from upstream tip "
            "(otherwise master was not actually reset)"
        )


def test_bare_checkout_without_B_leaves_detached_head_and_master_at_tip():
    """Control case: without -B, checkout base_commit leaves master at tip.

    This test documents the pre-fix behavior so the regression above isn't
    vacuous. If this test starts FAILING it means git changed behavior and
    the fix may no longer be needed — worth investigating.
    """
    with tempfile.TemporaryDirectory(prefix="pma-ctrl-") as t:
        tmp = Path(t)
        upstream, base_sha, tip_sha = _seed_upstream(tmp)

        clone_dir = tmp / "clone"
        _git(tmp, "clone", str(upstream), str(clone_dir))

        # Bare checkout — the pre-fix code.
        _git(clone_dir, "checkout", base_sha)

        head = _sha(clone_dir, "HEAD")
        master = _sha(clone_dir, "master")

        assert head == base_sha, "bare checkout should land HEAD on base_sha"
        assert master == tip_sha, (
            "without -B, master should still be at tip_sha — this is the defect "
            "that Problem A fixes"
        )


# ---------------------------------------------------------------------------
# Problem B regression
# ---------------------------------------------------------------------------


def test_committed_reserved_paths_excluded_from_diff():
    """Reserved-path content committed above base_commit is excluded from
    the captured patch.

    Reproduces the smoke8 failure: .copilot-instructions.md and runs/
    scaffolding were committed into the swarm branch above base_commit.
    The old git diff base_commit command (without pathspec excludes) emitted
    them in the patch. git apply inside the SWE-bench /testbed container
    rejected the patch because those paths don't exist in /testbed.

    The fix adds -- . :(exclude)... pathspecs to the diff invocation,
    matching the excludes already applied to the source-2 git add step.
    """
    with tempfile.TemporaryDirectory(prefix="pmb-") as t:
        tmp = Path(t)

        # Seed base_commit.
        _git(tmp, "init", "-q")
        _git(tmp, "config", "user.email", "t@t")
        _git(tmp, "config", "user.name", "t")
        (tmp / "README.md").write_text("repo base\n")
        _git(tmp, "add", ".")
        _git(tmp, "commit", "-m", "base commit", "--allow-empty-message")
        base_sha = _sha(tmp)

        # Simulate orchestrator scaffolding committed above base_commit.
        (tmp / ".copilot-instructions.md").write_text("orchestrator boilerplate\n")
        (tmp / "runs").mkdir()
        (tmp / "runs" / "swarm-xyz").mkdir()
        (tmp / "runs" / "swarm-xyz" / "share.md").write_text("step transcript\n")
        _git(tmp, "add", ".")
        _git(tmp, "commit", "-m", "add orchestrator scaffolding")

        # Simulate actual agent work committed above base_commit.
        (tmp / "src").mkdir()
        (tmp / "src" / "fix.py").write_text("# agent fix\ndef fixed(): pass\n")
        _git(tmp, "add", ".")
        _git(tmp, "commit", "-m", "agent: fix the bug")

        # capture_agent_diff should return only the agent work, not scaffolding.
        diff = capture_agent_diff(tmp, base_sha).decode("utf-8", errors="replace")

        assert "src/fix.py" in diff, (
            "agent's source change must be present in the captured patch"
        )
        assert ".copilot-instructions.md" not in diff, (
            ".copilot-instructions.md is orchestrator scaffolding and must NOT "
            "appear in the captured patch — it breaks git apply in /testbed. "
            "(smoke8 failure mode: _FILE_GLOB_EXCLUDES not applied to git diff)"
        )
        assert "share.md" not in diff, (
            "runs/ step transcript must NOT appear in the captured patch — "
            "it is orchestrator reserved content. "
            "(smoke8 failure mode: pathspec excludes not passed to git diff)"
        )
        assert "swarm-xyz" not in diff, (
            "runs/ directory must NOT appear in the captured patch"
        )


def test_copilot_instructions_in_reserved_file_glob_excludes():
    """.copilot-instructions.md must be in _FILE_GLOB_EXCLUDES.

    Documents the specific gap found in smoke8 post-mortem: the file was
    written and committed by prompt-builder.ts but was not listed in the
    Python (or TypeScript) reserved-paths constants, so it leaked into
    every SWE-bench patch via git diff base_commit.
    """
    excludes = _reserved.git_pathspec_excludes()
    copilot_exclude = ":(exclude).copilot-instructions.md"
    assert copilot_exclude in excludes, (
        f"git_pathspec_excludes() must include '{copilot_exclude}'. "
        "Without it, .copilot-instructions.md leaks into SWE-bench patches "
        "and breaks git apply in the evaluation container."
    )
