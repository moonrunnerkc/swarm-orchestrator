#!/usr/bin/env python3
"""
SWE-bench evaluation runner for swarm-orchestrator.

Downloads tasks from SWE-bench Lite (or Verified), checks out each repo
at its base commit, runs the orchestrator (or a baseline agent), applies
the resulting patch, and executes the gold test suite.

Results are written to benchmarks/swe-bench/results/<timestamp>.json.

Environment variables:
  SWEBENCH_SUBSET_SIZE   Number of tasks to evaluate (default: 10)
  SWEBENCH_DATASET       HuggingFace dataset ID (default: princeton-nlp/SWE-bench_Lite)
  SWARM_TOOL             Agent backend: copilot | claude-code | codex (default: claude-code)
  SWARM_MODEL            Model override (default: claude-sonnet-4)
  BASELINE_MODE          If "true", run agent directly without orchestrator
  TASK_TIMEOUT_SECONDS   Per-task timeout (default: 900)
"""

import argparse
import fnmatch
import glob
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from datasets import load_dataset
from tqdm import tqdm

# Local import — reserved-path list consumed by capture_agent_diff.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
from worktree_reserved_paths import git_pathspec_excludes  # noqa: E402

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUBSET_SIZE = int(os.environ.get("SWEBENCH_SUBSET_SIZE", "10"))
DATASET_ID = os.environ.get("SWEBENCH_DATASET", "princeton-nlp/SWE-bench_Lite")
# When set, load the exact instance_ids listed in this JSON file (produced by
# benchmarks/swe-bench/sample_instances.py). Overrides SUBSET_SIZE's ad-hoc
# diverse-repo walk and makes the sample deterministic + auditable.
INSTANCES_FILE = os.environ.get("SWEBENCH_INSTANCES_FILE", "")
SWARM_TOOL = os.environ.get("SWARM_TOOL", "claude-code")
SWARM_MODEL = os.environ.get("SWARM_MODEL", "claude-sonnet-4")
BASELINE_MODE = os.environ.get("BASELINE_MODE", "false").lower() == "true"
TASK_TIMEOUT = int(os.environ.get("TASK_TIMEOUT_SECONDS", "900"))
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
RESULTS_DIR = Path(os.environ.get("RESULTS_DIR", str(_REPO_ROOT / "benchmarks" / "swe-bench" / "results")))
_LOCAL_BIN = _REPO_ROOT / "dist" / "src" / "cli.js"
SWARM_BIN = Path(os.environ.get("SWARM_BIN", str(_LOCAL_BIN) if _LOCAL_BIN.exists() else "/app/swarm/dist/src/cli.js"))
CACHE_DIR = Path(os.environ.get("HF_HOME", str(_REPO_ROOT / ".cache" / "huggingface")))

# Per-instance eval image registry. perinstance_image() appends
# `.<instance_id>:latest` to this prefix. Default is the Epoch Research
# mirror on GHCR, which publishes pre-built SWE-bench eval images keyed
# on the official swebench `sweb.eval.x86_64.<instance_id>` naming (with
# the `sweb` → `swe-bench` rewrite their mirror uses). Override with
# PERINSTANCE_IMAGE_REGISTRY to point at a private registry or a different
# mirror — the string is expected to be the full prefix up to (but not
# including) `.<instance_id>:latest`.
PERINSTANCE_IMAGE_REGISTRY = os.environ.get(
    "PERINSTANCE_IMAGE_REGISTRY",
    "ghcr.io/epoch-research/swe-bench.eval.x86_64",
)


# ---------------------------------------------------------------------------
# Diff capture (bytes-safe, with size guardrails)
# ---------------------------------------------------------------------------

# Soft ceiling on agent-diff size. A diff this large is almost always scope
# pollution (build output, vendor trees, upstream source re-emitted) rather
# than the agent's actual work, and shipping it downstream would either fail
# to apply or waste real money on a doomed evaluation. Fail loud instead.
MAX_DIFF_BYTES = 10 * 1024 * 1024


class DiffCaptureError(RuntimeError):
    """Raised when capture_agent_diff produces a diff that cannot be trusted.

    Empty diffs mean the agent made no changes — a real failure mode worth
    surfacing rather than handing a zero-byte patch to the downstream
    evaluator. Oversized diffs mean the intent-to-add scope pulled in noise
    that would waste cycles (and potentially premium requests) on apply
    failures.
    """


def load_agent_manifest(repo_dir: Path) -> list[str]:
    """Aggregate per-step `filesChanged` lists from the orchestrator's
    context-broker state. Returns a sorted list of repo-relative paths the
    orchestrator recorded as agent-touched across every completed step.

    Source of truth: `<repo_dir>/runs/swarm-*/.context/shared-context.json`.
    That file is written by `ContextBroker.addStepContext()` after each
    step's verification passes, with `data.filesChanged` populated from the
    agent's `/share` transcript.

    Completeness caveat (issue #27 Issue 2): this manifest is agent-self-
    reported. Files the agent modified without recording in the transcript
    are NOT listed here. capture_agent_diff compensates by additionally
    staging OS-observed changes outside reserved paths — the "∪ OS-observed"
    half of the option-1b union.

    Missing or malformed manifest files are not fatal; returns [].
    """
    runs_root = repo_dir / "runs"
    if not runs_root.is_dir():
        return []
    # Most-recent swarm-* run dir wins — one eval invocation produces one
    # orchestrator run, but tests and dev environments may have leftovers.
    candidates = sorted(
        (p for p in runs_root.iterdir() if p.is_dir() and p.name.startswith("swarm-")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        return []
    ctx_file = candidates[0] / ".context" / "shared-context.json"
    if not ctx_file.exists():
        return []
    try:
        entries = json.loads(ctx_file.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return []
    files: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        data = entry.get("data") or {}
        for f in data.get("filesChanged") or []:
            if isinstance(f, str) and f:
                files.add(f)
    return sorted(files)


def capture_agent_diff(
    repo_dir: Path,
    base_commit: str,
    manifest_files: list[str] | None = None,
) -> bytes:
    """Collect the agent's changes as a unified diff against the base commit.

    Union-based capture (issue #27 Issue 2 / option 1b). Two sources:

      1. **manifest_files** — files the agent claimed to touch, loaded
         from the orchestrator's context-broker state. Each is staged for
         intent-to-add directly, with no exclusion applied — an agent-
         claimed modification inside an orchestrator-reserved path is
         still intentional agent work and should appear in the diff.
      2. **OS-observed changes outside reserved paths** — everything else
         in the worktree that git sees as modified or untracked, minus
         the reserved-path set from worktree_reserved_paths. Picks up
         silent agent edits the transcript might have missed, without
         letting orchestrator scratch (runs/, node_modules/, etc.) leak
         into the diff.

    The union covers both completeness gaps identified in the issue #27
    halt report:
      - agent silent edits → caught by source 2
      - orchestrator-internal worktree writes → excluded by source 2's
        reserved-path filter, and source 1's manifest never includes them
        because the orchestrator doesn't write to its own transcripts.

    Returns raw bytes. `git diff` output can contain non-UTF-8 content —
    filenames in legacy encodings, binary-file markers, text files with
    latin-1 residue. Decoding at capture time raises UnicodeDecodeError
    on real-world workdirs; callers that need a string should decode at
    the point of use with errors='replace'.

    @raises DiffCaptureError when the diff is empty (no changes — real
            failure) or larger than MAX_DIFF_BYTES (scope pollution).
    """
    # Source 1: explicit manifest files (no exclusion — agent claim wins).
    if manifest_files:
        for rel in manifest_files:
            # Skip paths that traverse upward or escape the repo.
            if rel.startswith("/") or ".." in Path(rel).parts:
                continue
            full = repo_dir / rel
            # Only stage files that actually exist — a missing file means
            # the agent claimed a deletion (git add -A picks that up via
            # source 2) or hallucinated the claim (not our bug to fix).
            if full.exists():
                subprocess.run(
                    ["git", "add", "-N", "--", rel],
                    cwd=str(repo_dir),
                    capture_output=True,
                    timeout=30,
                )

    # Source 2: `-A -N` over the whole worktree, minus reserved paths.
    # A positive pathspec (`.`) is required alongside negative excludes —
    # an exclude-only pathspec list matches nothing in git.
    add_cmd = ["git", "add", "-A", "-N", "--", "."] + git_pathspec_excludes()
    subprocess.run(add_cmd, cwd=str(repo_dir), capture_output=True, timeout=30)

    # Intentionally omits HEAD so working-tree changes (including intent-to-
    # add silent edits staged by source 2 above) are captured. The `git diff
    # <base> HEAD` form would silently exclude them — which is exactly the
    # silent-edit case the union approach exists to surface. See #27 for
    # context. Do not "fix" this to include HEAD without re-reading.
    #
    # Pathspec excludes are applied here for the same reason they are applied
    # to the source 2 `git add -A -N` above: orchestrator-reserved content
    # that was *committed* into the history above base_commit (e.g. runs/,
    # .copilot-instructions.md) would otherwise appear in `git diff base_commit`
    # because it exists in HEAD's tree. The `-- . :(exclude)...` form requires
    # a positive pathspec (`.`) alongside the excludes; an exclude-only list
    # matches nothing in git, same as with `git add`. See smoke8 post-mortem.
    result = subprocess.run(
        ["git", "diff", base_commit, "--", "."] + git_pathspec_excludes(),
        cwd=str(repo_dir),
        capture_output=True,
        timeout=60,
    )
    diff = result.stdout or b""

    if len(diff) == 0:
        raise DiffCaptureError(
            f"capture_agent_diff: empty diff for {repo_dir} vs {base_commit[:12]}. "
            f"The agent produced no changes against the base commit — real "
            f"failure mode worth surfacing rather than shipping a zero-byte "
            f"patch downstream."
        )
    if len(diff) > MAX_DIFF_BYTES:
        raise DiffCaptureError(
            f"capture_agent_diff: diff is {len(diff):,} bytes (> {MAX_DIFF_BYTES:,}). "
            f"Intent-to-add scope is probably pulling in noise (build output, "
            f"vendor dirs, upstream source re-emitted by the orchestrator's "
            f"run tree). Refusing to hand this to the evaluator — it would "
            f"fail to apply and burn real money."
        )
    return diff


# ---------------------------------------------------------------------------
# RC fixes — helper functions
# ---------------------------------------------------------------------------

# Globs identifying paths that belong to the gold test patch, not to the
# implementation the agent should edit. Shared between revert_test_files
# (host-venv, RC6) and strip_test_file_hunks (container path). Keeping both
# paths in sync on a single list prevents drift where one backend thinks a
# file is a test and the other doesn't — that kind of split was the v6.0.0
# smoke9 failure mode multiplied across 50 instances.
TEST_FILE_PATTERNS = ["**/test_*.py", "**/tests/**/*.py"]


def revert_test_files(repo_dir: Path) -> list:
    """[RC6] Revert any test files modified by the agent before gold patch apply.

    LLM agents sometimes modify test files despite prompt instructions. This
    causes `git apply` of the gold test patch to fail. We detect modified test
    files via `git diff --name-only HEAD` and revert them with `git checkout`.
    Runs unconditionally for all tasks.
    """
    try:
        diff_result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if diff_result.returncode != 0:
            return []

        modified = [f.strip() for f in diff_result.stdout.splitlines() if f.strip()]
        test_files = []
        for f in modified:
            for pat in TEST_FILE_PATTERNS:
                if fnmatch.fnmatch(f, pat):
                    test_files.append(f)
                    break

        if test_files:
            subprocess.run(
                ["git", "checkout", "--"] + test_files,
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=30,
            )
            for tf in test_files:
                print(f"  [RC6] reverted {tf}")

        return test_files
    except (subprocess.TimeoutExpired, Exception) as exc:
        print(f"  [RC6] warning: revert_test_files failed: {exc}")
        return []


def strip_test_file_hunks(agent_diff: bytes) -> tuple[bytes, list[str]]:
    """[RC6 container port] Drop per-file hunks targeting test files.

    The container eval applies the agent diff against /testbed, then applies
    the gold test patch on top. The gold test patch was built against the
    pristine base_commit, so if the agent also edited the same test file
    the gold patch's context no longer matches and `git apply` rejects it.

    The host-venv path's `revert_test_files` (RC6) fixes this by reverting
    the worktree's test files with `git checkout` before the gold apply.
    The container has no live worktree to operate on, so the equivalent
    is to filter the diff in Python before writing the stdin payload.

    Detection uses TEST_FILE_PATTERNS, the same globs RC6 uses, so the
    two backends stay aligned.

    Returns (filtered_diff, [stripped_b_paths]). `agent_diff` is bytes
    in, bytes out — the orchestrator's diff can contain non-UTF-8 content
    and downstream consumers expect bytes. A diff that doesn't start with
    a `diff --git` header is passed through unchanged.
    """
    if not agent_diff or not agent_diff.lstrip().startswith(b"diff --git"):
        return agent_diff, []

    # `(?m)(?=^diff --git )` partitions on per-file boundaries without
    # consuming the header — every non-empty chunk after the split starts
    # with `diff --git ...`. Any preamble bytes before the first header
    # come through as the leading chunk and are preserved in `kept` when
    # they don't match the header regex (defensive: real orchestrator
    # diffs won't have preamble, but don't silently eat bytes if they do).
    parts = re.split(b"(?m)(?=^diff --git )", agent_diff)
    kept: list[bytes] = []
    stripped: list[str] = []
    header_re = re.compile(rb"^diff --git a/(\S+) b/(\S+)")
    for chunk in parts:
        if not chunk.strip():
            continue
        m = header_re.match(chunk)
        if not m:
            kept.append(chunk)
            continue
        b_path = m.group(2).decode("utf-8", errors="replace")
        if any(fnmatch.fnmatch(b_path, pat) for pat in TEST_FILE_PATTERNS):
            stripped.append(b_path)
        else:
            kept.append(chunk)
    return b"".join(kept), stripped


def setuptools_scm_env(base_env: dict) -> dict:
    """[RC7] Add SETUPTOOLS_SCM_PRETEND_VERSION to the environment.

    astropy (and other repos) use setuptools_scm to derive version info from
    git tags. SWE-bench checkouts are detached commits without tags, causing
    broken version.py. Setting SETUPTOOLS_SCM_PRETEND_VERSION is harmless for
    repos that don't use setuptools_scm.
    Applied globally.
    """
    env = {**base_env, "SETUPTOOLS_SCM_PRETEND_VERSION": "0.0.dev0"}
    print("  [RC7] set SETUPTOOLS_SCM_PRETEND_VERSION=0.0.dev0")
    return env


def detect_django_settings(repo_dir: Path, task_id: str, base_env: dict) -> dict:
    """[RC9] Set DJANGO_SETTINGS_MODULE for Django repos.

    Django tasks fail with ImproperlyConfigured when no settings module is
    configured. SWE-bench's official harness uses 'test_sqlite'.
    """
    is_django = task_id.startswith("django__") or (repo_dir / "django").is_dir()
    if is_django:
        env = {**base_env, "DJANGO_SETTINGS_MODULE": "test_sqlite"}
        print(f"  [RC9] set DJANGO_SETTINGS_MODULE=test_sqlite for {task_id}")
        return env
    return base_env


def install_seaborn_deps(repo_dir: Path, task_id: str, venv_python: str) -> None:
    """[RC8] Install matplotlib+pandas for seaborn tasks.

    seaborn's __init__.py imports matplotlib at import time, but the per-task
    venv often doesn't get a compatible version via extras.
    Also checks for seaborn/external/version.py existence.
    """
    if not task_id.startswith("mwaskom__seaborn"):
        return

    print(f"  [RC8] installing matplotlib pandas for seaborn task {task_id}")
    subprocess.run(
        [venv_python, "-m", "pip", "install", "--quiet", "matplotlib", "pandas"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
        timeout=120,
    )

    version_file = repo_dir / "seaborn" / "external" / "version.py"
    if not version_file.exists():
        print(f"  [RC8] WARNING: seaborn/external/version.py not found at this "
              f"base commit — gold test patch may reference code not present. "
              f"Task may be unsolvable as configured.")


def pin_flask_dependencies(repo_dir: Path, task_id: str, venv_python: str) -> None:
    """[RC10] Pin werkzeug<3.0 for flask tasks.

    flask-4045's base commit expects an older werkzeug that had `url_quote`
    in `werkzeug.urls`. Latest werkzeug removed that symbol.
    """
    if not task_id.startswith("pallets__flask"):
        return

    print(f"  [RC10] pinning werkzeug<3.0 for flask task {task_id}")
    subprocess.run(
        [venv_python, "-m", "pip", "install", "--quiet", "werkzeug<3.0"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
        timeout=120,
    )


def load_tasks():
    """Load and return SWE-bench tasks.

    Two modes:
      (1) SWEBENCH_INSTANCES_FILE set — load the exact instance_ids from the
          JSON manifest. This is the deterministic path used by PR 3a+ and
          the full sweep. Sample-size check enforced.
      (2) Legacy path — SUBSET_SIZE-based diverse-repo walk. Kept for
          backwards compatibility with older scripts.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ds = load_dataset(DATASET_ID, split="test", cache_dir=str(CACHE_DIR))

    if INSTANCES_FILE:
        manifest_path = Path(INSTANCES_FILE)
        if not manifest_path.exists():
            raise SystemExit(
                f"SWEBENCH_INSTANCES_FILE={INSTANCES_FILE} does not exist. "
                f"Produce it with benchmarks/swe-bench/sample_instances.py."
            )
        manifest = json.loads(manifest_path.read_text())
        wanted = set(manifest["instance_ids"])
        if not wanted:
            raise SystemExit(f"{INSTANCES_FILE}: instance_ids is empty")

        by_id = {item["instance_id"]: item for item in ds}
        missing = wanted - set(by_id)
        if missing:
            raise SystemExit(
                f"{len(missing)} instance_ids from {INSTANCES_FILE} not in "
                f"dataset {DATASET_ID}. Sample (first 3): {sorted(missing)[:3]}"
            )

        tasks = [by_id[i] for i in manifest["instance_ids"]]
        repos = sorted({t["repo"] for t in tasks})
        print(
            f"Loaded {len(tasks)} tasks from {manifest_path} "
            f"(seed={manifest.get('seed')}, repos={len(repos)})"
        )
        return tasks

    # Legacy ad-hoc selection path.
    print(f"Loading dataset: {DATASET_ID} (subset: {SUBSET_SIZE})")
    seen_repos = set()
    diverse_tasks = []
    for item in ds:
        repo = item["repo"]
        if repo not in seen_repos:
            seen_repos.add(repo)
            diverse_tasks.append(item)
        if len(diverse_tasks) >= SUBSET_SIZE:
            break

    if len(diverse_tasks) < SUBSET_SIZE:
        for item in ds:
            if item not in diverse_tasks:
                diverse_tasks.append(item)
            if len(diverse_tasks) >= SUBSET_SIZE:
                break

    print(f"  Selected {len(diverse_tasks)} tasks from {len(seen_repos)} repos")
    return diverse_tasks


def checkout_repo(task, workdir: Path) -> Path:
    """Clone the repository and checkout the base commit."""
    repo_url = f"https://github.com/{task['repo']}.git"
    repo_dir = workdir / task["instance_id"]

    # Use treeless partial clone — downloads all commits but fetches blobs on demand.
    # Much faster than full clone for large repos like django/astropy.
    subprocess.run(
        ["git", "clone", "--filter=blob:none", repo_url, str(repo_dir)],
        check=True,
        capture_output=True,
        timeout=300,
    )
    # Reset the local master branch to base_commit rather than just checking out a
    # detached HEAD. Without -B, master stays at the clone tip (potentially tens of
    # thousands of commits ahead), and the branch-merger later merges the swarm branch
    # into that tip, causing git diff base_commit..HEAD to capture all upstream history.
    subprocess.run(
        ["git", "checkout", "-B", "master", task["base_commit"]],
        cwd=str(repo_dir),
        check=True,
        capture_output=True,
        timeout=120,
    )
    return repo_dir


def run_orchestrator(repo_dir: Path, problem_statement: str) -> dict:
    """Run swarm-orchestrator (or baseline) against the task."""
    start = time.monotonic()
    env = {**os.environ, "NODE_NO_WARNINGS": "1"}

    if BASELINE_MODE:
        # Direct single-agent execution — run Claude CLI directly, bypassing orchestrator.
        # This tests the raw agent capability without orchestrator's planning/verification.
        # Truncate the prompt to avoid E2BIG — baseline evaluates raw agent capability,
        # not the orchestrator's prompt-management. Keep first 100K chars.
        truncated = problem_statement[:100_000]
        prompt_text = f"Fix this issue. Only edit source code files, do not edit tests.\n\n{truncated}"
        cmd = [
            "claude", "--dangerously-skip-permissions",
            "-p", prompt_text,
        ]
        prompt_text = None  # Don't pipe via stdin for baseline
    else:
        # Full orchestrator pipeline.
        # The "do not edit tests" constraint goes through --agent-guidance, NOT
        # --goal. --goal is the raw SWE-bench problem_statement; --agent-guidance
        # is appended to each plan step's task by the orchestrator AFTER
        # classification. Previously we concatenated the constraint into --goal,
        # which poisoned the planner's classifier (the word "tests" in the
        # constraint matched TesterElite's keyword patterns and the planner
        # allocated a tester as primary agent for bug-fix tasks). See issue
        # #27 Fix 1 / sympy__sympy-12481 smoke3 findings.
        agent_guidance = (
            "IMPORTANT: Do NOT modify, delete, or rewrite any test files. "
            "Only edit source code to fix the issue. Test files are verified "
            "by an external harness and your edits will cause patch conflicts."
        )
        # --target makes the target-mode discriminator fire. The orchestrator's
        # cwd during this subprocess IS repo_dir, but that alone is not a
        # structural signal — `swarm run` invoked from inside the orchestrator's
        # own repo also has cwd == repo root. Passing --target explicitly tells
        # the orchestrator "this is an external-repo run" so SELF_IMPROVEMENT
        # quality gates (accessibility, duplicate-blocks, etc.) skip instead
        # of firing nonsensically against sympy and triggering replan churn.
        # See #27 PR 1 (target-mode gate scoping) and smoke5 follow-up.
        prompt_text = None
        cmd = [
            "node", str(SWARM_BIN), "run",
            "--goal", problem_statement,
            "--agent-guidance", agent_guidance,
            "--target", str(repo_dir),
            "--tool", SWARM_TOOL,
            "--yes",
        ]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_dir),
            env=env,
            input=prompt_text,
            capture_output=True,
            text=True,
            timeout=TASK_TIMEOUT,
        )
        elapsed = time.monotonic() - start
        return {
            "returncode": result.returncode,
            "stdout": result.stdout[-5000:] if result.stdout else "",
            "stderr": result.stderr[-2000:] if result.stderr else "",
            "elapsed_seconds": round(elapsed, 2),
        }
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - start
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": "TIMEOUT",
            "elapsed_seconds": round(elapsed, 2),
        }


def run_gold_tests(repo_dir: Path, task: dict) -> dict:
    """Apply the gold test patch and run the FAIL_TO_PASS test suite.

    SWE-bench defines resolution as: the FAIL_TO_PASS tests must pass after
    the agent's fix is applied. If any of these tests still fail, the task
    is not resolved.

    Test IDs come in two formats:
      - pytest-style:   "path/to/test.py::TestClass::test_method"
      - unittest-style: "test_method (module.path.TestClass)"
    Both are handled and routed to pytest.
    """
    task_id = task.get("instance_id", "")
    test_patch = task.get("test_patch", "")
    if not test_patch:
        return {"passed": False, "reason": "no test patch available"}

    # [RC6] Revert test files the agent may have modified
    revert_test_files(repo_dir)

    # Apply the test patch
    try:
        proc = subprocess.run(
            ["git", "apply", "--allow-empty", "-"],
            input=test_patch,
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode != 0:
            return {"passed": False, "reason": f"test patch apply failed: {proc.stderr[:500]}"}
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": "test patch apply timed out"}

    # Install the repo in an isolated virtualenv so tests can import it
    # without polluting the global env or conflicting across tasks.
    # In Docker, build-essential + scientific deps are pre-installed.
    # [RC7] Build env with setuptools_scm fallback (global, harmless for non-scm repos)
    pip_env = setuptools_scm_env(os.environ.copy())
    # [RC9] Add Django settings if applicable
    pip_env = detect_django_settings(repo_dir, task_id, pip_env)

    venv_dir = repo_dir / ".venv"
    venv_python = "python3"  # Default fallback
    try:
        subprocess.run(
            ["python3", "-m", "venv", str(venv_dir)],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
        venv_python = str(venv_dir / "bin" / "python3")
        # Upgrade pip and install build tools inside the venv
        subprocess.run(
            [venv_python, "-m", "pip", "install", "--quiet", "--upgrade",
             "pip", "setuptools", "wheel", "cython"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=120,
            env=pip_env,
        )
        # [RC10] Pin werkzeug for flask tasks BEFORE editable install
        pin_flask_dependencies(repo_dir, task_id, venv_python)

        # Install the repo in editable mode with test extras.
        # Try [test,dev,testing] first (covers most projects), fall back to
        # [test] only, then bare editable install as last resort.
        installed = False
        for extras in ['".[test,dev,testing]"', '".[test]"', '".[dev]"', '"."']:
            install_result = subprocess.run(
                f'{venv_python} -m pip install -e {extras} --quiet --no-build-isolation',
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=600,
                shell=True,
                env=pip_env,
            )
            if install_result.returncode == 0:
                installed = True
                break
        if not installed:
            # Last resort: bare install without extras
            subprocess.run(
                [venv_python, "-m", "pip", "install", "-e", ".", "--quiet"],
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=600,
                env=pip_env,
            )

        # [RC8] Install seaborn-specific deps after editable install
        install_seaborn_deps(repo_dir, task_id, venv_python)

        # Install per-repo pinned test requirements if they exist
        for req_file in ["requirements-dev.txt", "requirements-test.txt",
                         "requirements_dev.txt", "requirements_test.txt",
                         "test-requirements.txt", "test_requirements.txt"]:
            req_path = repo_dir / req_file
            if req_path.exists():
                subprocess.run(
                    [venv_python, "-m", "pip", "install", "--quiet", "-r", str(req_path)],
                    cwd=str(repo_dir),
                    capture_output=True,
                    text=True,
                    timeout=300,
                    env=pip_env,
                )

        # Also install pytest and hypothesis (common test dependency) inside the venv
        subprocess.run(
            [venv_python, "-m", "pip", "install", "--quiet", "pytest", "hypothesis"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
            env=pip_env,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        venv_python = "python3"  # Fall back to system Python

    # Parse FAIL_TO_PASS — JSON-encoded list of test identifiers
    fail_to_pass_raw = task.get("FAIL_TO_PASS", "")
    if isinstance(fail_to_pass_raw, str):
        fail_to_pass = json.loads(fail_to_pass_raw) if fail_to_pass_raw else []
    elif isinstance(fail_to_pass_raw, list):
        fail_to_pass = fail_to_pass_raw
    else:
        fail_to_pass = []

    if not fail_to_pass:
        return {"passed": False, "reason": "no FAIL_TO_PASS tests specified"}

    # Convert test IDs to pytest-compatible format via the shared helper
    # so the host-venv and container paths apply the same scoping rules.
    # Without this, bare function names in FAIL_TO_PASS would use an
    # unbounded `-k` filter here while the container path scopes it.
    pytest_targets, k_filters = build_pytest_args(fail_to_pass, test_patch)

    # Build pytest command.
    # Use the per-repo venv python so imports resolve correctly.
    # Falls back to system python3 when venv creation failed.
    cmd_parts = [venv_python, "-m", "pytest", "--tb=short", "-q"]
    cmd_parts.extend(pytest_targets)
    if k_filters:
        k_expr = " or ".join(f"({f})" for f in k_filters)
        cmd_parts.extend(["-k", k_expr])

    try:
        result = subprocess.run(
            cmd_parts,
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=600,
            env=pip_env,
        )
        return {
            "passed": result.returncode == 0,
            "returncode": result.returncode,
            "fail_to_pass_ids": fail_to_pass,
            "test_command": " ".join(cmd_parts),
            "stdout_tail": result.stdout[-3000:] if result.stdout else "",
            "stderr_tail": result.stderr[-1000:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": "test execution timed out"}


def extract_test_patch_files(test_patch: str) -> list[str]:
    """Return b-side file paths from a unified diff, in order of appearance.

    Used to bound pytest's -k substring match to the files the gold test
    patch actually touches. Parsing is permissive: no header means no
    files, no exception — the caller decides whether that's fatal.
    """
    if not test_patch:
        return []
    return [m.group(1) for m in re.finditer(r"(?m)^diff --git a/\S+ b/(\S+)", test_patch)]


def parse_fail_to_pass(task: dict) -> list[str]:
    """Return SWE-bench FAIL_TO_PASS test ids from either JSON or list form."""
    fail_to_pass_raw = task.get("FAIL_TO_PASS", "")
    if isinstance(fail_to_pass_raw, str):
        return json.loads(fail_to_pass_raw) if fail_to_pass_raw else []
    if isinstance(fail_to_pass_raw, list):
        return [item for item in fail_to_pass_raw if isinstance(item, str)]
    return []


def build_swebench_differential_gate_input(
    task: dict,
    agent_branch: str = "HEAD",
    python_executable: str = "python",
) -> dict:
    """Build the layer-1 differential gate input from SWE-bench FAIL_TO_PASS.

    The TypeScript gate needs a concrete test command. SWE-bench supplies
    FAIL_TO_PASS ids, so this helper applies the same pytest scoping logic as
    run_gold_tests/run_gold_tests_in_container and packages the base commit,
    patch ref, and command in one auditable record.
    """
    fail_to_pass = parse_fail_to_pass(task)
    if not fail_to_pass:
        return {
            "ready": False,
            "reason": "no FAIL_TO_PASS tests specified",
            "fail_to_pass_ids": [],
        }

    pytest_targets, k_filters = build_pytest_args(
        fail_to_pass,
        task.get("test_patch", ""),
    )
    parts = [python_executable, "-m", "pytest", "--tb=short", "-q"]
    parts.extend(pytest_targets)
    if k_filters:
        parts.extend(["-k", " or ".join(f"({f})" for f in k_filters)])

    return {
        "ready": True,
        "base_commit": task["base_commit"],
        "agent_branch": agent_branch,
        "test_command": " ".join(shlex.quote(part) for part in parts),
        "fail_to_pass_ids": fail_to_pass,
    }


def build_pytest_args(
    fail_to_pass: list[str],
    test_patch: str = "",
) -> tuple[list[str], list[str]]:
    """Convert SWE-bench FAIL_TO_PASS test IDs into pytest targets + -k filters.

    SWE-bench records test IDs in three formats we have to map onto pytest:
      1. pytest-style node ID: "path/to/test.py::TestClass::test_method"
      2. unittest-style:       "test_method (module.path.TestClass)"
      3. bare function name:   "test_args"  (case we must scope)

    (1) becomes a direct pytest positional target. (2) becomes a `-k`
    filter that ands the class and method. (3) is the ambiguous case:
    `-k 'test_args'` tells pytest "run any test whose node ID contains
    'test_args'", and pytest's node ID includes the module path — so a
    bare name collides with every test in any module whose *filename*
    contains the string. Observed on sympy__sympy-12481: bare
    "test_args" matched all 732 tests in sympy/core/tests/test_args.py
    (a file named after that string but unrelated to the fix), 78 of
    which had pre-existing unrelated failures, and the instance was
    scored 0/1 despite the orchestrator's patch being correct.

    Scoping: when a bare name appears, the files extracted from the
    gold test_patch are passed as pytest positionals so `-k` is bounded
    to tests in those files. Option A from the RC6-port rationale:
    `pytest <file> -k <name>` rather than a fully qualified node ID,
    so class-nested tests still resolve.

    If no test_patch is provided (defensive — host-venv and container
    paths both supply one), the bare name falls through to the legacy
    unbounded `-k` to preserve prior behavior on any caller that
    forgets to pass test_patch.
    """
    pytest_targets: list[str] = []
    k_filters: list[str] = []
    bare_names: list[str] = []
    for tid in fail_to_pass:
        if "::" in tid:
            pytest_targets.append(tid)
        elif "(" in tid and ")" in tid:
            method, rest = tid.split("(", 1)
            method = method.strip()
            module_class = rest.rstrip(")").strip()
            parts = module_class.rsplit(".", 1)
            if len(parts) == 2:
                class_name = parts[1]
                k_filters.append(f"{class_name} and {method}")
            else:
                k_filters.append(method)
        else:
            bare_names.append(tid)

    if bare_names:
        test_patch_files = extract_test_patch_files(test_patch)
        if test_patch_files:
            pytest_targets.extend(test_patch_files)
            k_filters.extend(bare_names)
            print(
                f"  [pytest-scoping] scoped {len(bare_names)} bare test "
                f"name(s) to {len(test_patch_files)} test_patch file(s): "
                f"names={bare_names} files={test_patch_files}"
            )
        else:
            # No test_patch available — legacy unbounded -k.
            k_filters.extend(bare_names)
    return pytest_targets, k_filters


def docker_available() -> bool:
    try:
        subprocess.run(
            ["docker", "ps"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=True,
        )
        return True
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def perinstance_image(instance_id: str) -> str:
    return f"{PERINSTANCE_IMAGE_REGISTRY}.{instance_id}:latest"


def run_gold_tests_in_container(task: dict, agent_diff: bytes) -> dict:
    """Apply agent diff + gold test patch inside the per-instance image and run pytest.

    This is the honest eval path. Every SWE-bench instance ships with an
    env image pinned to the Python/dep versions the base commit expects,
    so test collection and import semantics match the era the issue was
    filed against. Contrast with the host-venv path (run_gold_tests),
    which re-uses the evaluator host's Python interpreter and therefore
    misattributes collection errors from e.g. `from collections import Mapping`
    removed in 3.10 as orchestrator failures.
    """
    instance_id = task["instance_id"]
    image = perinstance_image(instance_id)
    test_patch = task.get("test_patch", "")
    if not test_patch:
        return {"passed": False, "reason": "no test patch available", "backend": "container"}

    fail_to_pass_raw = task.get("FAIL_TO_PASS", "")
    if isinstance(fail_to_pass_raw, str):
        fail_to_pass = json.loads(fail_to_pass_raw) if fail_to_pass_raw else []
    elif isinstance(fail_to_pass_raw, list):
        fail_to_pass = fail_to_pass_raw
    else:
        fail_to_pass = []
    if not fail_to_pass:
        return {"passed": False, "reason": "no FAIL_TO_PASS tests specified", "backend": "container"}

    # RC6 port for the container path. The host-venv side reverts agent
    # test-file edits on the live worktree before gold apply; here there
    # is no worktree, so we drop test-file hunks from the diff instead.
    # Without this step any instance where the agent also touched tests
    # fails gold-patch apply (exit 43) with a context-mismatch error.
    agent_diff, stripped_test_files = strip_test_file_hunks(agent_diff)
    if stripped_test_files:
        print(
            f"  [RC6-container] stripped {len(stripped_test_files)} test-file "
            f"hunk(s) from agent patch: {stripped_test_files}"
        )
    if not agent_diff:
        return {
            "passed": False,
            "reason": "agent produced test-only changes, no implementation patch",
            "backend": "container",
            "image": image,
            "stripped_test_files": stripped_test_files,
        }

    pytest_targets, k_filters = build_pytest_args(fail_to_pass, test_patch)

    # Build the in-container script. Patches come in via stdin split by sentinels.
    # Keeping this as one bash -lc string is the simplest way to hit the shared
    # test invocation semantics across instances without baking assumptions
    # into the Dockerfile.
    target_args = " ".join(f"'{t}'" for t in pytest_targets) or ""
    k_expr = " or ".join(f"({f})" for f in k_filters)
    k_arg = f"-k '{k_expr}'" if k_expr else ""
    # Notes on the bash plumbing below:
    #   - Stdin is buffered to /tmp/payload first, then awk-ed twice. Reading
    #     /dev/stdin from two separate awk invocations drops the test patch:
    #     the first awk drains the pipe and the second sees EOF, leaving
    #     /tmp/test.patch empty. --allow-empty previously masked this by
    #     accepting the zero-byte patch silently; removing --allow-empty
    #     (next bullet) would surface it as an exit-43 if left unfixed.
    #     Buffering to a file lets both extractions see the full payload.
    #   - `git apply` runs without --allow-empty because the per-instance
    #     images ship git 2.34.1 (Ubuntu 22.04) and the flag was added in
    #     git 2.39. capture_agent_diff raises on an empty agent diff so a
    #     zero-byte /tmp/agent.patch cannot reach here; the enclosing
    #     `-s` test additionally short-circuits if it somehow does. The
    #     test_patch is populated from the SWE-bench dataset and always
    #     contains hunks for a FAIL_TO_PASS-bearing instance.
    script = (
        "set -eo pipefail\n"
        "cd /testbed\n"
        "python -m pip install --quiet pytest hypothesis 2>&1 | tail -1 || true\n"
        "cat > /tmp/payload\n"
        "awk '/^__AGENT_PATCH__$/,/^__END_AGENT_PATCH__$/' /tmp/payload "
        "  | sed '1d;$d' > /tmp/agent.patch\n"
        "awk '/^__TEST_PATCH__$/,/^__END_TEST_PATCH__$/' /tmp/payload "
        "  | sed '1d;$d' > /tmp/test.patch\n"
        "if [ -s /tmp/agent.patch ]; then\n"
        "  git apply /tmp/agent.patch 2>/tmp/apply.err || {\n"
        "    echo '__AGENT_PATCH_APPLY_FAILED__' >&2; cat /tmp/apply.err >&2; exit 42;\n"
        "  }\n"
        "fi\n"
        "git apply /tmp/test.patch 2>/tmp/test-apply.err || {\n"
        "  echo '__TEST_PATCH_APPLY_FAILED__' >&2; cat /tmp/test-apply.err >&2; exit 43;\n"
        "}\n"
        f"python -m pytest --tb=short -q {target_args} {k_arg}\n"
    )

    # Agent diff stays bytes through the pipe — it may contain non-UTF-8
    # content. Test patch comes from the dataset (always valid UTF-8) so
    # bytes-encoding it is straightforward.
    stdin_payload = (
        b"__AGENT_PATCH__\n" + agent_diff + b"\n__END_AGENT_PATCH__\n"
        b"__TEST_PATCH__\n" + test_patch.encode("utf-8") + b"\n__END_TEST_PATCH__\n"
    )

    try:
        result = subprocess.run(
            ["docker", "run", "--rm", "-i", "--platform", "linux/amd64", image,
             "bash", "-lc", script],
            input=stdin_payload,
            capture_output=True,
            timeout=900,
        )
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": "test execution timed out in container",
                "backend": "container", "image": image}
    except FileNotFoundError:
        return {"passed": False, "reason": "docker CLI not available",
                "backend": "container", "image": image}

    # Decode container output at use-time with errors='replace' so non-UTF-8
    # bytes in pytest stderr (file-path diffs, unicode test names) don't crash
    # the reporter.
    stdout = (result.stdout or b"").decode("utf-8", errors="replace")
    stderr = (result.stderr or b"").decode("utf-8", errors="replace")
    reason = None
    if result.returncode == 42:
        reason = "agent patch did not apply cleanly against /testbed"
    elif result.returncode == 43:
        reason = "gold test patch did not apply cleanly"

    return {
        "passed": result.returncode == 0,
        "returncode": result.returncode,
        "backend": "container",
        "image": image,
        "fail_to_pass_ids": fail_to_pass,
        "test_command": (
            f"(in container) python -m pytest --tb=short -q "
            f"{target_args} {k_arg}"
        ).strip(),
        "stdout_tail": stdout[-3000:],
        "stderr_tail": stderr[-1000:],
        "reason": reason,
    }


def run_tests_dispatch(task: dict, repo_dir: Path) -> dict:
    """Prefer per-instance container eval; fall back to host venv when Docker
    is unreachable. The fallback is dev-only; sweeps that land in fallback
    mode must be tagged as such so results aren't mixed with container runs.

    The capture_agent_diff call passes the orchestrator's per-step changed-
    files manifest via load_agent_manifest. That's the "source 1" half of
    the #27 Issue 2 / option 1b union — explicit agent claims staged no
    matter where they live, complemented by source 2's OS-observed staging
    outside reserved paths.
    """
    if docker_available():
        try:
            manifest = load_agent_manifest(repo_dir)
            agent_diff = capture_agent_diff(
                repo_dir, task["base_commit"], manifest_files=manifest,
            )
        except DiffCaptureError as exc:
            return {
                "passed": False,
                "reason": str(exc),
                "backend": "container",
                "image": perinstance_image(task["instance_id"]),
            }
        return run_gold_tests_in_container(task, agent_diff)
    result = run_gold_tests(repo_dir, task)
    result["backend"] = "host-venv-fallback"
    return result


def _print_workspace_preserved(workdir: Path) -> None:
    """Print the preserved workspace path and ready-to-paste diagnostic commands."""
    print(f"\n{'='*60}")
    print(f"Workspace preserved at: {workdir}")
    print("Diagnostic commands:")
    print(f"  cd {workdir}/<instance_id>")
    print("  git status --short | wc -l")
    print("  git diff HEAD --stat | tail -30")
    print("  git diff HEAD --name-only | awk -F/ '{print $1}' | sort | uniq -c | sort -rn | head -20")
    print("  git diff HEAD --name-only | awk -F. '{print $NF}' | sort | uniq -c | sort -rn | head -20")
    print("  git diff HEAD --numstat | sort -rn | head -10")
    print(f"{'='*60}")


def evaluate_tasks(*, keep_workdir: bool = False) -> dict:
    """Main evaluation loop.

    Args:
        keep_workdir: When True, the temporary workspace directory is NOT
            deleted after the run. The path is printed prominently with
            ready-to-paste diagnostic commands. Default is False (clean up
            on exit, matching the original behavior).
    """
    tasks = load_tasks()
    results = []
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    workdir = Path(tempfile.mkdtemp(prefix="swebench-"))
    try:
        for task in tqdm(tasks, desc="Evaluating"):
            instance_id = task["instance_id"]
            print(f"\n{'='*60}")
            print(f"Task: {instance_id}")
            print(f"Repo: {task['repo']} @ {task['base_commit'][:12]}")
            print(f"{'='*60}")

            task_result = {
                "instance_id": instance_id,
                "repo": task["repo"],
                "base_commit": task["base_commit"],
                "mode": "baseline" if BASELINE_MODE else "orchestrator",
                "tool": SWARM_TOOL,
                "model": SWARM_MODEL,
                "differential_gate": build_swebench_differential_gate_input(task),
            }

            # Step 1: Checkout
            try:
                repo_dir = checkout_repo(task, workdir)
            except Exception as e:
                task_result["status"] = "checkout_failed"
                task_result["error"] = str(e)[:500]
                results.append(task_result)
                continue

            # Step 2: Run orchestrator / baseline
            run_result = run_orchestrator(repo_dir, task["problem_statement"])
            task_result["run"] = run_result

            # Step 3: Run gold tests via the dispatcher so we pick the
            # per-instance container (honest eval) when Docker is available
            # and fall back to the host venv only when it is not. Calling
            # run_gold_tests directly skips that choice and silently pins
            # every run to host-venv mode, where Python-version drift against
            # the task's base commit misattributes stdlib ImportErrors (e.g.
            # `collections.Mapping` in Python 3.10+) as orchestrator failures.
            test_result = run_tests_dispatch(task, repo_dir)
            task_result["tests"] = test_result
            task_result["resolved"] = test_result.get("passed", False)

            results.append(task_result)
            print(f"  → {'RESOLVED' if task_result['resolved'] else 'FAILED'}"
                  f" ({run_result['elapsed_seconds']:.1f}s)")
    finally:
        if keep_workdir:
            _print_workspace_preserved(workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)

    # Write results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_file = RESULTS_DIR / f"eval-{timestamp}.json"

    summary = {
        "timestamp": timestamp,
        "dataset": DATASET_ID,
        "subset_size": len(tasks),
        "mode": "baseline" if BASELINE_MODE else "orchestrator",
        "tool": SWARM_TOOL,
        "model": SWARM_MODEL,
        "resolved": sum(1 for r in results if r.get("resolved")),
        "total": len(results),
        "percent_resolved": round(
            100 * sum(1 for r in results if r.get("resolved")) / max(len(results), 1), 1
        ),
        "mean_latency_seconds": round(
            sum(r.get("run", {}).get("elapsed_seconds", 0) for r in results)
            / max(len(results), 1),
            2,
        ),
        "tasks": results,
    }

    with open(output_file, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print(f"RESULTS: {summary['resolved']}/{summary['total']} resolved "
          f"({summary['percent_resolved']}%)")
    print(f"Mean latency: {summary['mean_latency_seconds']}s")
    print(f"Output: {output_file}")
    print(f"{'='*60}")

    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="SWE-bench evaluation runner for swarm-orchestrator."
    )
    parser.add_argument(
        "--keep-workdir",
        action="store_true",
        default=False,
        help=(
            "Preserve the temporary workspace directory after the run instead of "
            "deleting it. The path is printed at the end with ready-to-paste "
            "diagnostic commands. Useful for post-run inspection of git state. "
            "Default: off (workdir is deleted on exit)."
        ),
    )
    args = parser.parse_args()
    evaluate_tasks(keep_workdir=args.keep_workdir)
