"""Regression tests for issue #27 Issue 2 / option 1b — manifest ∪ OS-observed
capture with centralized reserved-paths.

Core contract (from the #27 halt report):
  the captured diff = {manifest files} ∪ {OS-observed changes outside
  reserved paths}

Four-quadrant test verifies every combination of (agent-claimed, OS-visible,
reserved-path) holds:
  (A) agent claims file X, X exists, X is outside reserved → IN the diff
  (B) agent silently modifies Y without claiming it, Y is outside reserved →
      IN the diff (manifest gap closed by OS-observed source)
  (C) orchestrator writes Z under a reserved path → NOT in the diff
      (runs/ is the ambient example)
  (D) orchestrator writes W to a non-reserved path (hypothetical bug) → IN
      the diff (we surface it rather than hide it). If D starts showing up
      as normal orchestrator operation rather than a bug, that's the halt
      signal from the #27 Issue 2 scope discussion.

Run:
  python3 -m pytest benchmarks/swe-bench/tests/test_union_capture.py -v
"""
from __future__ import annotations

import importlib.util
import json
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
except Exception as exc:  # pragma: no cover
    pytest.skip(f"run_swebench.py did not import cleanly: {exc}", allow_module_level=True)

capture_agent_diff = _module.capture_agent_diff
load_agent_manifest = _module.load_agent_manifest

# Import the reserved-paths module directly so the test can exercise its
# public surface independent of run_swebench.py's integration.
_RESERVED_SPEC = importlib.util.spec_from_file_location(
    "worktree_reserved_paths",
    _HERE.parent / "evaluation-scripts" / "worktree_reserved_paths.py",
)
_reserved = importlib.util.module_from_spec(_RESERVED_SPEC)
_RESERVED_SPEC.loader.exec_module(_reserved)  # type: ignore[union-attr]
ORCHESTRATOR_RESERVED_PATHS = _reserved.ORCHESTRATOR_RESERVED_PATHS
BUILD_ARTIFACT_RESERVED_PATHS = _reserved.BUILD_ARTIFACT_RESERVED_PATHS
git_pathspec_excludes = _reserved.git_pathspec_excludes


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
        env={**GIT_ENV},
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


def test_reserved_paths_list_is_bounded():
    """Halt-signal test from #27: if the reserved-paths list grows past 15
    entries, the codebase is arguing for option 2 (restructure orchestrator
    writes) rather than option 1b (exclude-list). Lock in a bound so that
    crossing it surfaces at test time, not silently."""
    total = (
        len(ORCHESTRATOR_RESERVED_PATHS)
        + len(BUILD_ARTIFACT_RESERVED_PATHS)
    )
    assert total <= 15, (
        f"reserved-paths list has grown to {total} entries. The #27 Issue 2 "
        f"analysis called out 15+ as the signal that option 2 is being "
        f"argued for by the codebase's actual structure. Review whether "
        f"each new path is genuinely orchestrator-owned before adding it."
    )


def test_four_quadrant_union():
    """The core option-1b contract, worked through all four quadrants.

    Quadrant A: agent claims file, exists, outside reserved → IN diff
    Quadrant B: silent agent edit, outside reserved → IN diff
    Quadrant C: orchestrator scratch under reserved path → NOT in diff
    Quadrant D: orchestrator wrote to non-reserved path → IN diff
    """
    with tempfile.TemporaryDirectory(prefix="union-4q-") as t:
        tmp = Path(t)
        base = _seed_repo(tmp)

        # (A) agent-claimed + exists + outside reserved → in diff
        (tmp / "src").mkdir()
        (tmp / "src" / "a.py").write_text("# agent claims this change\n")

        # (B) silent agent edit outside reserved → in diff (OS-observed)
        (tmp / "src" / "b.py").write_text("# agent edited but did not claim\n")

        # (C) orchestrator scratch under `runs/` — reserved → excluded
        (tmp / "runs" / "swarm-xyz").mkdir(parents=True)
        (tmp / "runs" / "swarm-xyz" / "session-state.json").write_text('{"noise":1}\n')

        # (D) hypothetical orchestrator bug writes to a non-reserved path → in diff
        (tmp / "docs").mkdir()
        (tmp / "docs" / "d.txt").write_text("orchestrator-written, non-reserved\n")

        # Commit A + D so git diff <base>..HEAD will surface them (matches
        # the real orchestrator shape where the integration branch has
        # committed state by the time the diff is captured). B stays
        # uncommitted as a "silent edit in working tree" — source 2 stages
        # it for intent-to-add.
        _git(tmp, "add", "src/a.py", "docs/d.txt")
        _git(tmp, "commit", "-m", "committed changes")

        # Manifest contains A only (the agent claimed A, did not claim B
        # because the silent-edit blind spot is the whole point of this
        # test).
        manifest = ["src/a.py"]

        raw = capture_agent_diff(tmp, base, manifest_files=manifest)
        diff = raw.decode("utf-8", errors="replace")

        # A — agent-claimed, committed, outside reserved → present
        assert "src/a.py" in diff, "A (agent-claimed + committed) must be in the diff"

        # B — silent edit, staged via source 2's -A -N → present
        assert "src/b.py" in diff, (
            "B (silent agent edit outside reserved) must be in the diff — this "
            "is the completeness gap source 2 closes"
        )

        # C — under runs/ → excluded by reserved-path rule
        assert "runs/swarm-xyz" not in diff, (
            "C (orchestrator scratch under runs/) must NOT be in the diff"
        )
        assert "session-state.json" not in diff, (
            "C (session-state.json under runs/) must NOT be in the diff"
        )

        # D — non-reserved path → present (whether the orchestrator should
        # have written there is a separate question the halt condition
        # covers; for THIS contract, the diff faithfully reports it)
        assert "docs/d.txt" in diff, (
            "D (orchestrator wrote to non-reserved path, hypothetical bug) "
            "must be in the diff — we surface this rather than hide it, so "
            "a regression where the orchestrator routinely writes outside "
            "reserved paths becomes visible in eval output."
        )


def test_manifest_file_under_reserved_path_is_filtered_out():
    """Reserved-path filter is unconditional at diff time, even for files
    the agent's manifest claims.

    Semantic change: PR #38 (commit 148bd7c) added git_pathspec_excludes()
    to the `git diff base_commit` invocation so orchestrator scaffolding
    committed above base_commit (.copilot-instructions.md, runs/) does not
    leak into the captured patch. That filter fires regardless of what the
    manifest reports, because the downstream /testbed container has no
    concept of reserved paths and would reject an apply referencing them.

    Consequence: an agent claim on a file under a reserved directory
    (plans/, runs/, dist/, etc.) is dropped from the final diff. This is
    intentional. In practice, agents should not be writing to orchestrator-
    reserved directories; if that becomes a routine failure mode, the fix
    is to narrow the reserved-path list, not to punch through the filter
    per-claim.

    Prior to #38 the assertion read the other way ("agent claim wins"),
    matching the #33 union-capture design. #38 superseded that when the
    smoke8 scaffolding-leak was traced to the diff step not applying the
    same excludes as the staging step. See docs/releases/RELEASE-v6.0.0.md
    Problem B.
    """
    with tempfile.TemporaryDirectory(prefix="union-reserved-") as t:
        tmp = Path(t)
        base = _seed_repo(tmp)

        # Also commit a non-reserved agent change so the capture has a
        # reason to succeed (capture_agent_diff raises DiffCaptureError on
        # an empty diff — a zero-byte patch is never a valid outcome).
        (tmp / "src").mkdir()
        (tmp / "src" / "fix.py").write_text("def fixed(): pass\n")

        # Agent modifies a file inside a reserved directory. `plans/` is
        # reserved; the agent claims it via the manifest.
        (tmp / "plans").mkdir()
        (tmp / "plans" / "agent-owned.json").write_text('{"agent":"wrote this"}\n')

        _git(tmp, "add", "src/fix.py", "plans/agent-owned.json")
        _git(tmp, "commit", "-m", "agent work including reserved path")

        diff = capture_agent_diff(
            tmp, base, manifest_files=["plans/agent-owned.json", "src/fix.py"]
        ).decode("utf-8", errors="replace")

        assert "src/fix.py" in diff, (
            "non-reserved manifest file must still appear in the diff — "
            "this is the control case proving capture_agent_diff ran"
        )
        assert "plans/agent-owned.json" not in diff, (
            "manifest-claimed file under reserved path must NOT appear in "
            "the diff — PR #38 applies git_pathspec_excludes() at diff time "
            "unconditionally, overriding any source-1 manifest claim. "
            "Changing this assertion without coordinating with the smoke8 "
            "fix will resurrect the scaffolding-leak into /testbed."
        )


def test_manifest_loader_handles_missing_and_malformed_state():
    """load_agent_manifest must not raise on a missing runs/ dir, missing
    shared-context.json, or malformed JSON — the caller can't rely on the
    orchestrator having produced valid state, and failing the eval because
    the manifest wasn't readable defeats the whole point."""
    with tempfile.TemporaryDirectory(prefix="union-manifest-") as t:
        tmp = Path(t)

        # No runs/ dir at all
        assert load_agent_manifest(tmp) == []

        # Empty runs/ dir
        (tmp / "runs").mkdir()
        assert load_agent_manifest(tmp) == []

        # runs/ dir with a non-swarm sibling
        (tmp / "runs" / "not-a-swarm-run").mkdir()
        assert load_agent_manifest(tmp) == []

        # swarm run dir but no .context
        (tmp / "runs" / "swarm-2026").mkdir()
        assert load_agent_manifest(tmp) == []

        # .context dir but no shared-context.json
        (tmp / "runs" / "swarm-2026" / ".context").mkdir()
        assert load_agent_manifest(tmp) == []

        # Malformed JSON
        (tmp / "runs" / "swarm-2026" / ".context" / "shared-context.json").write_text(
            "not valid json {",
        )
        assert load_agent_manifest(tmp) == []


def test_manifest_loader_aggregates_across_steps():
    """Happy path: shared-context.json contains one entry per completed
    step; the manifest is the sorted union of every entry's filesChanged."""
    with tempfile.TemporaryDirectory(prefix="union-aggregate-") as t:
        tmp = Path(t)
        ctx_dir = tmp / "runs" / "swarm-latest" / ".context"
        ctx_dir.mkdir(parents=True)
        (ctx_dir / "shared-context.json").write_text(
            json.dumps([
                {
                    "stepNumber": 1,
                    "agentName": "BackendMaster",
                    "timestamp": "2026-04-21T10:00:00Z",
                    "data": {
                        "filesChanged": ["src/auth.ts", "src/session.ts"],
                        "outputsSummary": "",
                    },
                },
                {
                    "stepNumber": 2,
                    "agentName": "TesterElite",
                    "timestamp": "2026-04-21T10:15:00Z",
                    "data": {
                        "filesChanged": ["test/auth.test.ts"],
                        "outputsSummary": "",
                    },
                },
                # An entry with no filesChanged — should be skipped, not error
                {
                    "stepNumber": 3,
                    "agentName": "IntegratorFinalizer",
                    "timestamp": "2026-04-21T10:30:00Z",
                    "data": {"outputsSummary": "no files"},
                },
            ]),
        )

        manifest = load_agent_manifest(tmp)
        assert manifest == [
            "src/auth.ts",
            "src/session.ts",
            "test/auth.test.ts",
        ], "sorted union of every step's filesChanged, duplicates de-duped"


def test_manifest_rejects_path_traversal_and_absolute_entries():
    """Defense in depth: a malformed or adversarial manifest shouldn't be
    able to trick capture_agent_diff into touching files outside the
    worktree. Absolute paths and `..` traversal get silently dropped."""
    with tempfile.TemporaryDirectory(prefix="union-safety-") as t:
        tmp = Path(t)
        base = _seed_repo(tmp)

        # Make at least one real change so the diff isn't empty
        (tmp / "legit.txt").write_text("legit agent change\n")
        _git(tmp, "add", "legit.txt")
        _git(tmp, "commit", "-m", "legit")

        # Manifest tries to escape. These must not crash, not raise, not
        # produce any git operations on those paths.
        adversarial = [
            "/etc/passwd",
            "../../../../etc/passwd",
            "legit.txt",  # the legitimate one
        ]
        diff = capture_agent_diff(tmp, base, manifest_files=adversarial).decode(
            "utf-8", errors="replace",
        )

        assert "legit.txt" in diff
        assert "/etc/passwd" not in diff
