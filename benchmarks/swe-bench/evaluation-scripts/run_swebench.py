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
        cmd = [
            "claude", "--dangerously-skip-permissions",
            "-p", f"Fix this issue. Only edit source code files, do not edit tests.\n\n{problem_statement}",
        ]
    else:
        # Full orchestrator pipeline
        cmd = [
            "node", str(SWARM_BIN), "run",
            "--goal", problem_statement,
            "--tool", SWARM_TOOL,
            "--yes",
        ]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_dir),
            env=env,
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
    test_patch = task.get("test_patch", "")
    if not test_patch:
        return {"passed": False, "reason": "no test patch available"}

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

    # Install the repo in editable mode so tests can import it.
    # Timeout at 300s — large scientific packages (astropy, matplotlib) can
    # take a while to build C extensions.
    try:
        subprocess.run(
            ["python3", "-m", "pip", "install", "-e", ".", "--quiet", "--no-build-isolation"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass  # Best-effort — tests may still work if deps are already installed

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
    # Use "python3" (system) for test execution. In Docker, dependencies are pre-installed.
    # Locally, tests may fail due to missing dependencies — this is documented.
    cmd_parts = ["python3", "-m", "pytest", "--tb=short", "-q"]
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
