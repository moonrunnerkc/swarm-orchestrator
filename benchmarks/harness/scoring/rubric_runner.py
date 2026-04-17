#!/usr/bin/env python3
"""
rubric_runner.py — Evaluate an artifact directory against the completeness rubric.

Usage:
  python3 rubric_runner.py <artifact_dir> <task_metadata_json>

Loads the task's applicable_attributes, runs each check, and outputs
a rubric score plus per-attribute results.

Output: JSON to stdout + <artifact_dir>/rubric-score.json
"""

import json
import os
import subprocess
import sys
from pathlib import Path

CHECKS_DIR = Path(__file__).parent / "checks"

# Map attribute IDs to their check scripts
ATTRIBUTE_CHECKS = {
    "SEC-INPUT":      "sec_input.sh",
    "SEC-NOSECRETS":  "sec_nosecrets.sh",
    "SEC-SARIF":      "sec_sarif.sh",
    "SEC-DEPS":       "sec_deps.sh",
    "SEC-AUTHN":      "sec_authn.sh",
    "SEC-AUTHZ":      "sec_authz.sh",
    "WIRE-START":     "wire_start.sh",
    "WIRE-ROUTES":    "wire_routes.sh",
    "WIRE-ENV":       "wire_env.sh",
    "WIRE-DB":        "wire_db.sh",
    "TEST-EXIST":     "test_exist.sh",
    "TEST-COV":       "test_cov.sh",
    "TEST-PASS":      "test_pass.sh",
    "TEST-NOMOD":     "test_nomod.sh",
    "ERR-NOBARE":     "err_nobare.sh",
    "ERR-STRUCT":     "err_struct.sh",
    "ERR-UNHANDLED":  "err_unhandled.sh",
    "A11Y-AXE":       "a11y_axe.sh",
    "A11Y-SEMANTIC":  "a11y_semantic.sh",
    "PROD-DEPLOY":    "prod_deploy.sh",
    "PROD-LOG":       "prod_log.sh",
    "PROD-README":    "prod_readme.sh",
}


def run_check(attribute_id: str, artifact_dir: str, task_meta_path: str) -> dict:
    """Run a single attribute check and return the result."""
    script = CHECKS_DIR / ATTRIBUTE_CHECKS.get(attribute_id, "")
    if not script.exists():
        return {
            "attribute_id": attribute_id,
            "applicable": True,
            "present": False,
            "evidence_path": None,
            "error": f"Check script not found: {script}",
        }

    try:
        result = subprocess.run(
            ["bash", str(script), artifact_dir, task_meta_path],
            capture_output=True,
            text=True,
            timeout=120,
        )
        # Parse JSON from stdout
        if result.stdout.strip():
            return json.loads(result.stdout.strip().split("\n")[-1])
        return {
            "attribute_id": attribute_id,
            "applicable": True,
            "present": result.returncode == 0,
            "evidence_path": None,
        }
    except subprocess.TimeoutExpired:
        return {
            "attribute_id": attribute_id,
            "applicable": True,
            "present": False,
            "evidence_path": None,
            "error": "Check timed out after 120s",
        }
    except (json.JSONDecodeError, Exception) as e:
        return {
            "attribute_id": attribute_id,
            "applicable": True,
            "present": False,
            "evidence_path": None,
            "error": str(e),
        }


def evaluate_rubric(artifact_dir: str, task_meta_path: str) -> dict:
    """Evaluate all applicable attributes and compute the rubric score."""
    with open(task_meta_path) as f:
        task = json.load(f)

    applicable_attrs = task.get("applicable_attributes", [])
    results = []
    present_count = 0
    applicable_count = 0

    for attr_id in applicable_attrs:
        check_result = run_check(attr_id, artifact_dir, task_meta_path)
        results.append(check_result)

        if check_result.get("applicable", True):
            applicable_count += 1
            if check_result.get("present", False):
                present_count += 1

    rubric_score = present_count / applicable_count if applicable_count > 0 else 0.0

    output = {
        "task_id": task.get("id", "unknown"),
        "artifact_dir": artifact_dir,
        "rubric_score": round(rubric_score, 4),
        "present_count": present_count,
        "applicable_count": applicable_count,
        "attributes": results,
    }

    # Write to artifact directory
    out_path = os.path.join(artifact_dir, "rubric-score.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    return output


def main():
    if len(sys.argv) < 3:
        print(
            "Usage: rubric_runner.py <artifact_dir> <task_metadata_json> [task_index]",
            file=sys.stderr,
        )
        print(
            "  task_metadata_json can be a single task object or an array of tasks.",
            file=sys.stderr,
        )
        print(
            "  If it is an array, provide task_index (0-based) as the 3rd argument.",
            file=sys.stderr,
        )
        sys.exit(1)

    artifact_dir = os.path.abspath(sys.argv[1])
    task_meta_path = sys.argv[2]
    task_index = int(sys.argv[3]) if len(sys.argv) > 3 else None

    if not os.path.isdir(artifact_dir):
        print(f"Error: artifact directory not found: {artifact_dir}", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(task_meta_path):
        print(f"Error: task metadata not found: {task_meta_path}", file=sys.stderr)
        sys.exit(1)

    # If task_index is provided, extract the single task from an array
    if task_index is not None:
        with open(task_meta_path) as f:
            tasks = json.load(f)
        if not isinstance(tasks, list):
            print(
                f"Error: expected JSON array in {task_meta_path} when task_index is given",
                file=sys.stderr,
            )
            sys.exit(1)
        task = tasks[task_index % len(tasks)]
        # Write single task to a temp file for evaluate_rubric
        tmp_path = os.path.join(artifact_dir, ".rubric_task_meta.json")
        with open(tmp_path, "w") as f:
            json.dump(task, f, indent=2)
        task_meta_path = tmp_path

    result = evaluate_rubric(artifact_dir, task_meta_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
