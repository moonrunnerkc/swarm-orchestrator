#!/usr/bin/env python3
"""
Phase 2 P1 eval driver. Prepares per-instance venvs and runs the
synthesizer (Layer 1) and property-gate (Layer 4) evals against
SWE-bench Verified instances.

The harness path in benchmarks/swe-bench/evaluation-scripts/run_swebench.py
runs synth and property hooks inline with a full agent sweep, which is
expensive and gated on Docker. This driver runs only the eval portion
end-to-end on the host: clone -> venv -> editable install -> gold
branch -> per-instance call to swebench-eval-cli.ts -> JSONL records.

Why a standalone driver and not the existing harness:

  - The 2026-04-30 smoke runs through the harness produced FN=100% with
    goldPass=false on every GENERATED instance, traced to two bugs:
    (a) hardcoded `cd <basePath>` in the synthesizer's testCommand
    overriding cwd in the gold worktree, and (b) no per-instance venv
    in either base or gold worktree so the synthesized test could not
    import the package under test.
  - This driver builds the venv before invoking the eval. The TS hook
    (scripts/eval/swebench-instance-evaluator.ts) accepts a venvBin
    field that wraps base + gold testCommand executions with PATH so
    `python`, `python3`, `pytest`, `pip` resolve to the venv binary.
    The cd-rewrite is also applied in the gold path.
  - These changes are scoped to scripts/eval/ + the Python harness env-
    setup path, per the Phase 2 step 2 directive.

Outputs:

  docs/p1-eval-fixtures/runs/<run-id>/
    synthesizer-eval.jsonl   — one record per instance from the synth hook
    property-gate-eval.jsonl — one record per instance from the property hook
    summary.json             — aggregate counts and per-instance status
    workspaces/              — preserved repo+venv per instance for re-runs

Run with:

  python3 scripts/eval/p1-run-evals.py \\
      --instances benchmarks/swe-bench/instances-smoke-5.json \\
      --n 10 \\
      --modes synth,property \\
      --out-dir docs/p1-eval-fixtures/runs/p1-eval-2026-05-01
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_HF_HOME = REPO_ROOT / ".cache" / "huggingface"
DEFAULT_INSTANCES = REPO_ROOT / "benchmarks" / "swe-bench" / "instances-50.json"
EVAL_CLI = REPO_ROOT / "scripts" / "eval" / "swebench-eval-cli.ts"

GOLD_BRANCH = "swarm-gold-eval"
DEFAULT_TIMEOUT_S = 600
DEFAULT_PER_INSTANCE_TIMEOUT_S = 900

EXTRAS_ATTEMPTS = ['".[test,dev,testing]"', '".[test]"', '".[dev]"', '"."']

# Mapping for repos whose Python import name does not match the GitHub repo
# slug. Most are 1:1 (django/django -> django), but a handful diverge.
IMPORT_NAME_OVERRIDES: dict[str, str] = {
    "scikit-learn": "sklearn",
}


# ---------------------------------------------------------------------------
# Per-instance prep — mirrors run_gold_tests's venv setup at smaller scope.
# ---------------------------------------------------------------------------


def env_with_setuptools_scm(base_env: dict[str, str]) -> dict[str, str]:
    """Pretend a setuptools_scm version so detached SWE-bench commits build.

    SWE-bench instances check out detached commits without git tags. Any
    repo using setuptools_scm fails the version-derivation step on a
    detached commit unless SETUPTOOLS_SCM_PRETEND_VERSION is set. The
    constant is harmless for repos that don't use setuptools_scm.
    """
    return {**base_env, "SETUPTOOLS_SCM_PRETEND_VERSION": "0.0.dev0"}


def env_with_django_settings(repo_dir: Path, task_id: str, base_env: dict[str, str]) -> dict[str, str]:
    """Set DJANGO_SETTINGS_MODULE so Django imports succeed in the venv.

    Django repos ImproperlyConfigured at import time without a settings
    module. The official SWE-bench harness uses test_sqlite, so we mirror.
    """
    is_django = task_id.startswith("django__") or (repo_dir / "django").is_dir()
    if is_django:
        return {**base_env, "DJANGO_SETTINGS_MODULE": "test_sqlite"}
    return base_env


def run(cmd: list[str] | str, *, cwd: Path | None = None, env: dict[str, str] | None = None,
        timeout: int = DEFAULT_TIMEOUT_S, check: bool = False, shell: bool = False) -> subprocess.CompletedProcess[str]:
    """Subprocess wrapper that captures output and never inherits stdin.

    Errors during corpus prep are surfaced with the failing command and
    truncated stdout/stderr, so the caller can decide whether to retry,
    skip the instance, or halt the whole run.
    """
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=check,
        shell=shell,
    )


@dataclass
class InstancePrepResult:
    """Status record produced by prepare_instance for one SWE-bench instance."""
    instance_id: str
    repo: str
    base_commit: str
    repo_dir: str
    venv_bin: str | None
    gold_branch: str | None
    prep_ok: bool
    import_ok: bool = False
    prep_errors: list[str] = field(default_factory=list)


def clone_repo(task: dict[str, Any], workdir: Path) -> Path:
    """Treeless clone the repo and check out base_commit.

    Treeless filter is the same shape used by run_swebench.py: fetch all
    commits, fetch blobs on demand. Faster than full clone for django and
    astropy where blob history dominates.
    """
    repo_url = f"https://github.com/{task['repo']}.git"
    repo_dir = workdir / task["instance_id"]
    if repo_dir.exists():
        # Re-using an existing prep is a feature for iteration; the gold
        # branch and venv may already be there. Caller chooses whether to
        # wipe by deleting workdir.
        return repo_dir
    run(
        ["git", "clone", "--filter=blob:none", repo_url, str(repo_dir)],
        timeout=600,
        check=True,
    )
    run(
        ["git", "checkout", "--detach", task["base_commit"]],
        cwd=repo_dir,
        check=True,
    )
    return repo_dir


def setup_venv(repo_dir: Path, task_id: str) -> tuple[Path | None, list[str]]:
    """Create .venv inside repo_dir and editable-install the package.

    Returns (venv_python, errors). venv_python is the absolute path to
    .venv/bin/python, or None if venv creation failed entirely. errors
    is a list of non-fatal warnings (extras install fall-through, missing
    requirements files), preserved on the result record so the eval
    interpretation has audit-trail.
    """
    errors: list[str] = []
    venv_dir = repo_dir / ".venv"
    if venv_dir.exists():
        venv_python = venv_dir / "bin" / "python3"
        if venv_python.exists():
            return venv_python, errors

    venv_create = run(["python3", "-m", "venv", str(venv_dir)], cwd=repo_dir, timeout=120)
    if venv_create.returncode != 0:
        errors.append(f"venv create failed: {venv_create.stderr.strip()[:300]}")
        return None, errors

    venv_python = venv_dir / "bin" / "python3"
    if not venv_python.exists():
        errors.append(f"venv python3 not found at {venv_python}")
        return None, errors

    pip_env = env_with_setuptools_scm(os.environ.copy())
    pip_env = env_with_django_settings(repo_dir, task_id, pip_env)

    upgrade = run(
        [str(venv_python), "-m", "pip", "install", "--quiet", "--upgrade",
         "pip", "setuptools", "wheel", "cython"],
        cwd=repo_dir, env=pip_env, timeout=180,
    )
    if upgrade.returncode != 0:
        errors.append(f"pip upgrade failed: {upgrade.stderr.strip()[:300]}")

    installed = False
    for extras in EXTRAS_ATTEMPTS:
        cmd = f'{venv_python} -m pip install -e {extras} --quiet --no-build-isolation'
        result = run(cmd, cwd=repo_dir, env=pip_env, timeout=DEFAULT_TIMEOUT_S, shell=True)
        if result.returncode == 0:
            installed = True
            break
        errors.append(f"editable install with {extras} failed: {result.stderr.strip()[:200]}")

    if not installed:
        errors.append("editable install with all extras patterns failed; package may not import")

    test_extras = run(
        [str(venv_python), "-m", "pip", "install", "--quiet", "pytest", "hypothesis"],
        cwd=repo_dir, env=pip_env, timeout=120,
    )
    if test_extras.returncode != 0:
        errors.append(f"pytest/hypothesis install failed: {test_extras.stderr.strip()[:300]}")

    for req_file in ("requirements-dev.txt", "requirements-test.txt",
                     "requirements_dev.txt", "requirements_test.txt",
                     "test-requirements.txt", "test_requirements.txt"):
        req_path = repo_dir / req_file
        if req_path.exists():
            run(
                [str(venv_python), "-m", "pip", "install", "--quiet", "-r", str(req_path)],
                cwd=repo_dir, env=pip_env, timeout=240,
            )

    return venv_python, errors


def derive_import_name(repo: str) -> str:
    """Map a SWE-bench repo slug to its top-level Python import name.

    Most SWE-bench Verified repos publish under the same import name as the
    GitHub repo basename (django/django -> django, astropy/astropy -> astropy).
    The known exceptions live in IMPORT_NAME_OVERRIDES.

    @param repo - Repo slug as produced by SWE-bench, in `owner/name` form.
    @returns The package name to pass to `python -c "import <name>"`.
    """
    parts = repo.split("/", 1)
    base = parts[1] if len(parts) == 2 else repo
    return IMPORT_NAME_OVERRIDES.get(base, base)


def verify_package_import(venv_python: Path, repo: str, task_id: str) -> tuple[bool, str | None]:
    """Run `python -c "import <pkg>"` from outside the repo to confirm the install worked.

    The check runs from /tmp so a stranded source-tree (no editable install
    completed, but the repo's own package directory still on sys.path via
    cwd) cannot mask the failure. Editable installs add a .pth file in
    site-packages, so the import resolves regardless of cwd when prep
    actually succeeded; if the .pth was never written, the import fails
    cleanly with ModuleNotFoundError.

    @param venv_python - Absolute path to the per-instance venv's python3.
    @param repo - SWE-bench repo slug, used to derive the import name.
    @param task_id - Instance id; used to set DJANGO_SETTINGS_MODULE for
                     Django repos so a top-level import does not raise
                     ImproperlyConfigured.
    @returns (ok, error_text). error_text is None on success, otherwise the
             stderr from the failed import (truncated to 500 chars).
    """
    name = derive_import_name(repo)
    env = env_with_setuptools_scm(os.environ.copy())
    env = env_with_django_settings(Path("/tmp"), task_id, env)
    result = run(
        [str(venv_python), "-c", f"import {name}"],
        cwd=Path("/tmp"),
        env=env,
        timeout=60,
    )
    if result.returncode == 0:
        return True, None
    return False, (result.stderr or result.stdout).strip()[:500]


def materialize_gold_branch(repo_dir: Path, gold_patch: str) -> str | None:
    """Apply gold_patch on a swarm-gold-eval branch and return its name.

    Returns None when the patch refuses to apply (rare; usually means the
    base_commit drifted or the patch text was tampered with). On success,
    the branch is pointed at a commit containing the gold fix and the
    working tree is restored to base.
    """
    if not gold_patch:
        return None
    head = run(["git", "rev-parse", "HEAD"], cwd=repo_dir, check=True).stdout.strip()

    run(["git", "checkout", "-B", GOLD_BRANCH], cwd=repo_dir, check=True)
    # `git apply --index` writes the patch to the working tree AND stages
    # exactly its diff in the index, with no scan of untracked files. The
    # earlier `git apply` + `git add -A` shape staged the entire untracked
    # corpus alongside the patch — including .venv/, which setup_venv()
    # populates before this function runs. The venv binaries (bin/python,
    # bin/python3, bin/pip) ended up tracked on the gold branch, and the
    # final `git checkout --detach <head>` deleted them from the working
    # tree because the base commit didn't carry them. The next basePass /
    # goldPass run then exited 127 with `python: command not found`. This
    # is round-5 of the harness fragility tracked in
    # docs/p1-eval-harness-diagnostic.md.
    apply = subprocess.run(
        ["git", "apply", "--index", "--whitespace=nowarn", "-"],
        cwd=str(repo_dir),
        input=gold_patch,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if apply.returncode != 0:
        run(["git", "checkout", "--detach", head], cwd=repo_dir)
        return None

    run(
        ["git", "-c", "user.email=p1-eval@swarm", "-c", "user.name=p1-eval",
         "commit", "-m", "[p1-eval] gold patch", "--allow-empty"],
        cwd=repo_dir, check=True,
    )
    run(["git", "checkout", "--detach", head], cwd=repo_dir, check=True)
    return GOLD_BRANCH


def prepare_instance(task: dict[str, Any], workdir: Path) -> InstancePrepResult:
    """Run clone + venv + import-verify + gold-branch for one SWE-bench instance.

    `prep_ok` is gated on three independent conditions: the venv exists, the
    target package can be imported from outside the repo (proving the
    editable install actually succeeded), and the gold patch applied. A
    venv that exists but cannot import its package is treated as a prep
    failure rather than silently feeding broken state to downstream tests.
    """
    instance_id = task["instance_id"]
    repo = task["repo"]
    errors: list[str] = []
    repo_dir = clone_repo(task, workdir)
    venv_python, venv_errs = setup_venv(repo_dir, instance_id)
    errors.extend(venv_errs)
    venv_bin = str(venv_python.parent) if venv_python else None

    import_ok = False
    if venv_python:
        import_ok, import_err = verify_package_import(venv_python, repo, instance_id)
        if not import_ok:
            errors.append(
                f"package import verification failed for '{derive_import_name(repo)}': "
                f"{import_err or 'no stderr captured'}"
            )

    gold_branch = materialize_gold_branch(repo_dir, task.get("patch", ""))
    if not gold_branch:
        errors.append("gold patch did not apply; goldPass cannot be measured")

    prep_ok = bool(venv_bin) and import_ok and bool(gold_branch)
    return InstancePrepResult(
        instance_id=instance_id,
        repo=task["repo"],
        base_commit=task["base_commit"],
        repo_dir=str(repo_dir),
        venv_bin=venv_bin,
        gold_branch=gold_branch,
        prep_ok=prep_ok,
        import_ok=import_ok,
        prep_errors=errors,
    )


# ---------------------------------------------------------------------------
# Eval invocation — calls the existing TS hook via tsx, one instance at a time.
# ---------------------------------------------------------------------------


def call_tsx(args: list[str], *, timeout: int = DEFAULT_PER_INSTANCE_TIMEOUT_S) -> subprocess.CompletedProcess[str]:
    """Invoke `npx tsx` on a CLI script with the given args.

    Logs the failing command on non-zero exit so a CI run preserves the
    audit trail. Does not raise — caller decides how to surface failures
    on the per-instance JSONL record.
    """
    full = ["npx", "tsx", str(EVAL_CLI), *args]
    return run(full, cwd=REPO_ROOT, timeout=timeout)


def run_synth_eval(prep: InstancePrepResult, task: dict[str, Any], out_jsonl: Path,
                   problem_statement: str) -> dict[str, Any]:
    """Run the synthesizer eval hook for one prepared instance.

    Writes one JSONL record to out_jsonl via the TS CLI's appendJsonlRecord.
    Returns either the decoded record or an ERROR-shaped record on failure.
    """
    payload: dict[str, Any] = {
        "instanceId": prep.instance_id,
        "problemStatement": problem_statement,
        "repoPath": prep.repo_dir,
    }
    if prep.gold_branch:
        payload["goldPatchRef"] = prep.gold_branch
    if prep.venv_bin:
        payload["venvBin"] = prep.venv_bin

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as task_file:
        json.dump(payload, task_file)
        task_path = task_file.name
    try:
        before = out_jsonl.stat().st_size if out_jsonl.exists() else 0
        result = call_tsx(["--mode", "synth", "--task", task_path, "--out", str(out_jsonl)])
        if result.returncode != 0:
            return {
                "instanceId": prep.instance_id,
                "status": "ERROR",
                "error": f"swebench-eval-cli synth exit {result.returncode}: {result.stderr.strip()[:500]}",
            }
        if not out_jsonl.exists() or out_jsonl.stat().st_size <= before:
            return {
                "instanceId": prep.instance_id,
                "status": "ERROR",
                "error": "eval CLI did not append a record",
            }
        last_line = out_jsonl.read_text(encoding="utf-8").splitlines()[-1]
        return json.loads(last_line)
    finally:
        Path(task_path).unlink(missing_ok=True)


def run_property_eval(prep: InstancePrepResult, task: dict[str, Any], out_jsonl: Path) -> dict[str, Any]:
    """Run the property-gate eval hook for one prepared instance."""
    payload: dict[str, Any] = {
        "instanceId": prep.instance_id,
        "repoPath": prep.repo_dir,
        "goldPatchText": task.get("patch", ""),
        "baseCommit": prep.base_commit,
    }
    if prep.venv_bin:
        payload["venvBin"] = prep.venv_bin

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as task_file:
        json.dump(payload, task_file)
        task_path = task_file.name
    try:
        before = out_jsonl.stat().st_size if out_jsonl.exists() else 0
        result = call_tsx(["--mode", "property", "--task", task_path, "--out", str(out_jsonl)])
        if result.returncode != 0:
            return {
                "instanceId": prep.instance_id,
                "status": "ERROR",
                "error": f"swebench-eval-cli property exit {result.returncode}: {result.stderr.strip()[:500]}",
            }
        if not out_jsonl.exists() or out_jsonl.stat().st_size <= before:
            return {
                "instanceId": prep.instance_id,
                "status": "ERROR",
                "error": "eval CLI did not append a record",
            }
        last_line = out_jsonl.read_text(encoding="utf-8").splitlines()[-1]
        return json.loads(last_line)
    finally:
        Path(task_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# CLI / driver
# ---------------------------------------------------------------------------


def load_dataset_instances(instance_ids: Iterable[str], hf_home: Path) -> list[dict[str, Any]]:
    """Materialize SWE-bench Verified records for the requested instance_ids.

    Uses the same dataset cache as run_swebench.py so a sweep that has
    already pulled the dataset doesn't re-download.
    """
    os.environ["HF_HOME"] = str(hf_home)
    from datasets import load_dataset  # type: ignore[import-not-found]
    ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test", cache_dir=str(hf_home))
    by_id = {item["instance_id"]: item for item in ds}
    missing = [i for i in instance_ids if i not in by_id]
    if missing:
        raise SystemExit(f"instance_ids not found in dataset: {missing[:5]}")
    return [by_id[i] for i in instance_ids]


def parse_modes(value: str) -> list[str]:
    """Parse --modes into a list, accepting synth, property, or comma-joined."""
    parts = [m.strip() for m in value.split(",") if m.strip()]
    for m in parts:
        if m not in ("synth", "property"):
            raise SystemExit(f"unknown mode: {m}; use synth or property")
    return parts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instances", default=str(DEFAULT_INSTANCES),
                        help="Manifest with instance_ids array")
    parser.add_argument("--n", type=int, default=10,
                        help="How many instances to process from the manifest (cap)")
    parser.add_argument("--modes", default="synth,property",
                        help="Comma-separated subset of {synth, property}")
    parser.add_argument("--out-dir", required=True,
                        help="Directory to write per-eval JSONL + summary")
    parser.add_argument("--workdir", default=None,
                        help="Persistent workspace dir; default: <out-dir>/workspaces")
    parser.add_argument("--hf-home", default=str(DEFAULT_HF_HOME),
                        help="HuggingFace cache home")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    # Resolve workdir to absolute up-front. Subprocess `cwd` plus a relative
    # path argument resolve against different roots (parent CWD vs subprocess
    # CWD), and that mismatch silently created doubly-nested .venv trees in
    # the 2026-05-01 synth-n10 run. Absolute paths everywhere prevents the
    # double-nest deterministically.
    workdir = (Path(args.workdir).resolve() if args.workdir else out_dir / "workspaces")
    workdir.mkdir(parents=True, exist_ok=True)

    modes = parse_modes(args.modes)

    manifest_path = Path(args.instances).resolve()
    if not manifest_path.exists():
        raise SystemExit(f"instances manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    all_instance_ids = manifest["instance_ids"]

    print(f"Loading {len(all_instance_ids)} candidate instances from {manifest_path.name} ...")
    all_tasks = load_dataset_instances(all_instance_ids, Path(args.hf_home))

    synth_jsonl = out_dir / "synthesizer-eval.jsonl"
    prop_jsonl = out_dir / "property-gate-eval.jsonl"

    summary: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "manifest": str(manifest_path),
        "requested_n": args.n,
        "modes": modes,
        "instances": [],
        "skipped_for_prep_failure": [],
    }

    accepted = 0
    for task in all_tasks:
        if accepted >= args.n:
            break
        print(f"\n=== {task['instance_id']} ({task['repo']}) ===")
        prep = prepare_instance(task, workdir)
        if not prep.prep_ok:
            print(f"  SKIP: prep failed ({len(prep.prep_errors)} errors)")
            for err in prep.prep_errors:
                print(f"    - {err.splitlines()[0][:200]}")
            summary["skipped_for_prep_failure"].append({
                "instance_id": prep.instance_id,
                "repo": prep.repo,
                "import_ok": prep.import_ok,
                "prep_errors": prep.prep_errors,
            })
            continue

        accepted += 1
        instance_summary: dict[str, Any] = {"prep": asdict(prep)}
        if "synth" in modes:
            print("  -> synth")
            record = run_synth_eval(prep, task, synth_jsonl, task.get("problem_statement", ""))
            instance_summary["synth"] = record
            print(f"     status={record.get('status')} fp={record.get('fp')} fn={record.get('fn')}")
        if "property" in modes:
            print("  -> property")
            record = run_property_eval(prep, task, prop_jsonl)
            instance_summary["property"] = record
            print(f"     status={record.get('status')} counterexamples={len(record.get('counterexamples', []))}")
        summary["instances"].append(instance_summary)

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    summary["accepted_count"] = accepted
    summary["skipped_count"] = len(summary["skipped_for_prep_failure"])
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(
        f"\nSummary: accepted={accepted}/{args.n} requested; "
        f"skipped_for_prep_failure={summary['skipped_count']}"
    )
    print(f"Summary: {out_dir / 'summary.json'}")
    print(f"Synth JSONL: {synth_jsonl}")
    print(f"Property JSONL: {prop_jsonl}")
    if accepted < args.n:
        print(
            f"WARNING: requested n={args.n} but only {accepted} instances passed prep. "
            f"Manifest exhausted before quota was filled.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
