#!/usr/bin/env python3
"""
SWE-bench evaluation runner for swarm-orchestrator.

Downloads tasks from SWE-bench Lite (or Verified), checks out each repo
at its base commit, runs the orchestrator (or a baseline agent), applies
the resulting patch, and executes the gold test suite.

Results are written to /app/results/<timestamp>.json.

Environment variables:
  SWEBENCH_SUBSET_SIZE   Number of tasks to evaluate (default: 10)
  SWEBENCH_DATASET       HuggingFace dataset ID (default: princeton-nlp/SWE-bench_Lite)
  SWARM_TOOL             Agent backend: copilot | claude-code | codex (default: claude-code)
  SWARM_MODEL            Model override (default: claude-sonnet-4)
  BASELINE_MODE          If "true", run agent directly without orchestrator
  TASK_TIMEOUT_SECONDS   Per-task timeout (default: 900)
"""

import fnmatch
import glob
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from datasets import load_dataset
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUBSET_SIZE = int(os.environ.get("SWEBENCH_SUBSET_SIZE", "10"))
DATASET_ID = os.environ.get("SWEBENCH_DATASET", "princeton-nlp/SWE-bench_Lite")
SWARM_TOOL = os.environ.get("SWARM_TOOL", "claude-code")
SWARM_MODEL = os.environ.get("SWARM_MODEL", "claude-sonnet-4")
BASELINE_MODE = os.environ.get("BASELINE_MODE", "false").lower() == "true"
TASK_TIMEOUT = int(os.environ.get("TASK_TIMEOUT_SECONDS", "900"))
RESULTS_DIR = Path(os.environ.get("RESULTS_DIR", "/app/results"))
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_LOCAL_BIN = _REPO_ROOT / "dist" / "src" / "cli.js"
SWARM_BIN = Path(os.environ.get("SWARM_BIN", str(_LOCAL_BIN) if _LOCAL_BIN.exists() else "/app/swarm/dist/src/cli.js"))
CACHE_DIR = Path(os.environ.get("HF_HOME", "/app/.cache"))


# ---------------------------------------------------------------------------
# RC fixes — helper functions
# ---------------------------------------------------------------------------


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
        test_patterns = ["**/test_*.py", "**/tests/**/*.py"]
        test_files = []
        for f in modified:
            for pat in test_patterns:
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
    """Load and return a subset of SWE-bench tasks."""
    print(f"Loading dataset: {DATASET_ID} (subset: {SUBSET_SIZE})")
    ds = load_dataset(DATASET_ID, split="test", cache_dir=str(CACHE_DIR))

    # Pick tasks from diverse repos for better coverage
    seen_repos = set()
    diverse_tasks = []
    for item in ds:
        repo = item["repo"]
        if repo not in seen_repos:
            seen_repos.add(repo)
            diverse_tasks.append(item)
        if len(diverse_tasks) >= SUBSET_SIZE:
            break

    # If not enough diverse repos, fill from remaining
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
    subprocess.run(
        ["git", "checkout", task["base_commit"]],
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
        # Prepend a constraint to avoid editing test files — SWE-bench applies
        # a gold test patch after the agent runs, and edits to test files cause
        # git-apply conflicts that always fail the evaluation.
        goal_with_constraint = (
            "IMPORTANT: Do NOT modify, delete, or rewrite any test files. "
            "Only edit source code to fix the issue. Test files are verified "
            "by an external harness and your edits will cause patch conflicts.\n\n"
            + problem_statement
        )
        prompt_text = None
        cmd = [
            "node", str(SWARM_BIN), "run",
            "--goal", goal_with_constraint,
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

    # Convert test IDs to pytest-compatible format.
    # unittest-style "test_method (module.Class)" → "module/path.py::Class::test_method" via -k
    pytest_targets = []
    k_filters = []
    for tid in fail_to_pass:
        if "::" in tid:
            # Already pytest-style path
            pytest_targets.append(tid)
        elif "(" in tid and ")" in tid:
            # unittest-style: "test_method (module.path.TestClass)"
            method, rest = tid.split("(", 1)
            method = method.strip()
            module_class = rest.rstrip(")").strip()
            parts = module_class.rsplit(".", 1)
            if len(parts) == 2:
                module_path = parts[0].replace(".", "/")
                class_name = parts[1]
                k_filters.append(f"{class_name} and {method}")
            else:
                k_filters.append(method)
        else:
            # Plain test name — use as -k filter
            k_filters.append(tid)

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


def evaluate_tasks():
    """Main evaluation loop."""
    tasks = load_tasks()
    results = []
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    with tempfile.TemporaryDirectory(prefix="swebench-") as tmpdir:
        workdir = Path(tmpdir)

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

            # Step 3: Run gold tests
            test_result = run_gold_tests(repo_dir, task)
            task_result["tests"] = test_result
            task_result["resolved"] = test_result.get("passed", False)

            results.append(task_result)
            print(f"  → {'RESOLVED' if task_result['resolved'] else 'FAILED'}"
                  f" ({run_result['elapsed_seconds']:.1f}s)")

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
    evaluate_tasks()
