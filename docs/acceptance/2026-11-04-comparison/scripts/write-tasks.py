"""Writes each comparison task's task.md, requirements.json, judge.toml and criteria.md."""
import hashlib, json, pathlib, sys

C = pathlib.Path("/Users/brad/projects/recovery-2026-10-31/swarm-orchestrator/docs/acceptance/2026-11-04-comparison")
NPM_CHECKS = {"test": "npm run test", "typecheck": "npm run typecheck", "build": "npm run build"}

TASKS = {
    "fix-claimcheck": dict(
        category="fix", repo="claimcheck", base="d381bec", kind="fix",
        source="claimcheck e050152 (\"fix: don't BLOCK when a whole test is deleted\"), base at its parent",
        text=(
            "claimcheck blocks a change that deletes a whole test. compareTestFile in "
            "src/checks/test-weakening.ts reports assertion-removed whenever a test file's expect() count "
            "drops, so deleting an obsolete test or splitting a file reads as stripping an assertion, and "
            "the decision BLOCKs. Deleting a test is ambiguous, not the strip-an-assertion cheat. When the "
            "expect() count drops and the file also has fewer test cases (it/test calls, including variants "
            "such as it.skip, it.only, test.each and xit), report a new test-weakening kind, test-removed, "
            "which the decision only WARNs on, like expected-value-changed. A drop in expect() calls with "
            "the test count unchanged is still assertion-removed and still blocks. Fix it, with a test."
        ),
        checks=NPM_CHECKS, tests=[{"name": "src::"}],
        held_out="npx vitest run src/checks/test-removed.held-out.test.ts src/core/test-removed-decision.held-out.test.ts",
        glob="src/**/*.held-out.test.ts",
        held_out_note="The three test cases the fix commit e050152 added, verbatim, moved into two new files so an agent adding tests to the existing test files does not touch a sealed path.",
    ),
    "feature-pubprep": dict(
        category="feature", repo="pubprep", base="99d8d05", kind="feature",
        source="new; written for this comparison",
        text=(
            "Add a --reviewers option to pubprep so a run can use only some of the three reviewers. It takes "
            "a comma-separated list of short names: tech-debt, docs and security, for tech-debt-reviewer, "
            "readme-docs-reviewer and security-reviewer. parseArgs returns the choice as `reviewers`, the full "
            "agent names in the order tech-debt, docs, security whatever order they were typed, each once even "
            "when repeated. Without the flag, leave `reviewers` unset; a run then uses all three, as now. A "
            "missing or empty value is an error naming the valid short names, and a name that isn't one of the "
            "three is an error naming it and the valid short names. orchestrate takes the same list as an "
            "optional `reviewers` param (all three when omitted) and runs only those reviewers, in parallel or "
            "in sequence, so only their reports are written and concatenated into combined-review.md; main "
            "passes the parsed list through. Document the flag in the --help text. Add tests."
        ),
        checks=NPM_CHECKS, tests=[{"name": "test::"}],
        held_out="npx vitest run test/reviewers.held-out.test.ts",
        glob="test/**/*.held-out.test.ts",
        held_out_note="Written from the task's wording: the parse cases (unset default, canonical order, repeats, empty, unknown, missing value, --help) and orchestrate running only the chosen reviewers, in parallel and in sequence.",
    ),
    "refactor-ironroot": dict(
        category="refactor", repo="ironroot", base="1d325c2", kind="refactor",
        source="new; written for this comparison",
        text=(
            "In ironroot, move the three built-in falsifiers out of src/ironroot/verification/falsification.py "
            "into a new module, src/ironroot/verification/builtin_claims.py: _falsify_chain_seq_monotonic, "
            "_falsify_parent_hash_linkage, _falsify_artifact_hash_stability, and the _BUILTIN_CLAIMS tuple that "
            "registers them. falsification.py keeps the claim types, the registry, get_claim_registry, "
            "reset_claim_registry_for_testing and run_falsification, and no longer defines the falsifiers or "
            "the tuple. This is a pure move: behavior doesn't change, the registry still seeds the same three "
            "claims in the same order, existing imports keep working (the tests import _BUILTIN_CLAIMS from "
            "ironroot.verification.falsification), and the tests stay as they are."
        ),
        checks={"test": "python3 -m pytest -q"}, tests=[],
        structure=[
            {"path": "src/ironroot/verification/builtin_claims.py", "contains": "async def _falsify_chain_seq_monotonic"},
            {"path": "src/ironroot/verification/builtin_claims.py", "contains": "async def _falsify_parent_hash_linkage"},
            {"path": "src/ironroot/verification/builtin_claims.py", "contains": "async def _falsify_artifact_hash_stability"},
            {"path": "src/ironroot/verification/builtin_claims.py", "contains": "_BUILTIN_CLAIMS"},
        ],
        held_out="python3 -m pytest -q --no-cov -p no:cacheprovider tests/integrity/test_builtin_claims_held_out.py",
        glob="tests/**/*held_out*",
        held_out_note="The structural check: builtin_claims.py defines the three falsifiers and _BUILTIN_CLAIMS; falsification.py defines none of them and keeps its types, registry and entry points; _BUILTIN_CLAIMS is still importable from falsification and is the same object; the registry seeds the same three claims in order, each falsifier living in builtin_claims. --no-cov because the project's addopts carry --cov-fail-under=30, which fails any single-file run.",
    ),
    "upgrade-claimcheck": dict(
        category="upgrade", repo="claimcheck", base="d93aea5", kind="upgrade",
        source="new; written for this comparison",
        text=(
            "Upgrade claimcheck to vitest 5: vitest and @vitest/coverage-v8 to ^5, with package-lock.json "
            "updated. Stryker's 9.x vitest runner can't drive vitest 5, so move @stryker-mutator/core and "
            "@stryker-mutator/vitest-runner to ^10 as well, and move the Stryker version claimcheck installs "
            "into the repos it checks (src/adapters/worktree-toolchain.ts) to 10.x for repos on vitest 2 and "
            "later; repos on vitest 1 keep 8.7.1. Typecheck, build and the test suite must stay green."
        ),
        checks=NPM_CHECKS, tests=[],
        packages=[
            {"name": "vitest", "ecosystem": "npm", "version": "5.x"},
            {"name": "@vitest/coverage-v8", "ecosystem": "npm", "version": "5.x"},
            {"name": "@stryker-mutator/core", "ecosystem": "npm", "version": "10.x"},
            {"name": "@stryker-mutator/vitest-runner", "ecosystem": "npm", "version": "10.x"},
        ],
        versions=[
            {"name": "vitest", "ecosystem": "npm", "range": "^5", "latest": False, "wording": "vitest and @vitest/coverage-v8 to ^5"},
            {"name": "@vitest/coverage-v8", "ecosystem": "npm", "range": "^5", "latest": False, "wording": "vitest and @vitest/coverage-v8 to ^5"},
            {"name": "@stryker-mutator/core", "ecosystem": "npm", "range": "^10", "latest": False, "wording": "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10"},
            {"name": "@stryker-mutator/vitest-runner", "ecosystem": "npm", "range": "^10", "latest": False, "wording": "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10"},
        ],
        held_out="npx vitest run src/adapters/stryker-overlay.held-out.test.ts",
        glob="src/**/*.held-out.test.ts",
        held_out_note="The compatibility check at the call site: prepareToolchain on a repo with a package-lock and vitest 5.1.0, 4.1.8 or 2.1.9 overlays @stryker-mutator/core and vitest-runner at one 10.x version, and on vitest 1.6.0 keeps 8.7.1. The package manager is mocked; nothing is installed.",
    ),
}

def toml_str(value):
    return json.dumps(value)

for name, t in TASKS.items():
    d = C / name
    d.mkdir(parents=True, exist_ok=True)
    full_base = t["base_full"] = sys.argv[sys.argv.index(name) + 1] if name in sys.argv else t["base"]
    (d / "task.md").write_text(t["text"] + "\n")
    requirement = {
        "id": "R1", "text": t["text"], "source": "user", "kind": t["kind"], "required": True,
        "assumptions": [], "versions": t.get("versions", []),
        "evidence": {"tests": t["tests"], "checks": list(t["checks"]), "structure": t.get("structure", []), "packages": t.get("packages", [])},
    }
    (d / "requirements.json").write_text(json.dumps([requirement], indent=1) + "\n")
    judge = "# The judge's declared checks: what swarm init infers for this repository at the base.\n[checks]\n"
    judge += "".join(f"{k} = {toml_str(v)}\n" for k, v in t["checks"].items())
    (d / "judge.toml").write_text(judge)
    held = sorted(p for p in (d / "held-out").rglob("*") if p.is_file())
    held_lines = "\n".join(f"- `{p.relative_to(d)}` sha256 `{hashlib.sha256(p.read_bytes()).hexdigest()}`" for p in held)
    criteria = f"""# {name}: acceptance criteria

Sealed before either agent started. Neither agent sees this file, `requirements.json`, `judge.toml`
or `held-out/`.

- Category: {t['category']}
- Repository: {t['repo']} (read-only; every run works in a clone)
- Base: `{full_base}`
- Source of the task: {t['source']}

## Requirement record

`requirements.json`, passed to `swarm-verify verify --requirements`. R1's text is the task as typed.

```json
{json.dumps([requirement], indent=1)}
```

## Declared checks

`judge.toml`, written as the judging clone's `swarm.toml` after sealing (what `swarm init` infers
for this repository):

```toml
{judge.rstrip()}
```

## Held-out check

Sealed with `swarm-verify init --seal '{t['glob']}'` from a `swarm.toml` whose only test check is
`held-out = {{ command = "{t['held_out']}", kind = "test" }}`. The files are copied from
`held-out/` into the judging clone, sealed out of it, and overlaid only for the held-out run.

{t['held_out_note']}

{held_lines}

## How both patches are judged

The same way, by `judge.sh`: a fresh clone at the base, the held-out files sealed, `judge.toml`
as `swarm.toml`, then `swarm-verify verify --base {full_base} --patch <patch.diff> --requirements
requirements.json`, isolated, dependencies prepared, then `swarm-verify replay`. The verdict's
requirement statuses and held-out result are the outcome.
"""
    (d / "criteria.md").write_text(criteria)
    print(name, full_base, len(held), "held-out file(s)")
