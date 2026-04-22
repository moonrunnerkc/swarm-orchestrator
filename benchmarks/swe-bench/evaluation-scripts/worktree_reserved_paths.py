"""Reserved paths for agent-diff capture (issue #27 Issue 2 / option 1b).

The orchestrator writes state to specific paths inside the agent's worktree
during normal operation (run metadata, step worktrees, quality-gate output,
planner scratch). Those paths must be excluded from the agent-diff or the
diff balloons with orchestrator noise that has nothing to do with the
agent's intent — exactly the 31.7 MB smoke3 failure mode.

Two categories, tracked separately so audit decisions stay legible:

  ORCHESTRATOR_RESERVED_PATHS — paths THIS codebase writes to as part of
  normal operation. Scraped from `src/**/*.ts` via the audit that
  accompanied issue #27's Issue 2 analysis. Update when a new code path
  starts writing to a new top-level directory inside the worktree.

  BUILD_ARTIFACT_RESERVED_PATHS — paths universal build tooling writes
  (package managers, compilers, test runners, venv tools). Not
  orchestrator-specific; reasonable to exclude from any agent-diff
  regardless of subsystem.

The union consumer is `capture_agent_diff`. The git pathspec form returned
by `git_pathspec_excludes()` is what gets appended to `git add`.

See src/plan-generator.ts context on Fixes 1-3 and the Issue 2 halt
report on issue #27 for the failure mode motivating this module.
"""
from __future__ import annotations


ORCHESTRATOR_RESERVED_PATHS: tuple[str, ...] = (
    # runDir tree — holds everything orchestrator-scoped:
    #   .context/shared-context.json (per-step manifest)
    #   .locks/ (git serialization locks)
    #   worktrees/step-N/ (per-step isolated worktrees)
    #   steps/step-N/share.md (transcripts)
    #   session-state.json, metrics.json, cost-attribution.json
    #   quality-gates/ (gate output)
    # Excluding "runs/" excludes every nested path, so we don't need to
    # list .context/, .locks/, worktrees/ etc. individually.
    "runs",
    # quick-fix-mode session scratch (src/quick-fix-mode.ts:187)
    ".quickfix",
    # PlanStorage default writes plan-*.json here when planDir isn't set
    # (src/plan-storage.ts:12)
    "plans",
)


BUILD_ARTIFACT_RESERVED_PATHS: tuple[str, ...] = (
    # Node
    "node_modules",
    # Python
    "__pycache__",
    ".venv",
    "venv",
    "env",
    # JS build tools
    ".next",
    ".turbo",
    ".cache",
    # Generic build output
    "dist",
    "build",
    # Test coverage
    "coverage",
)


# Pure file-glob patterns (not directories). Appended separately from the
# directory-glob expansion below.
_FILE_GLOB_EXCLUDES: tuple[str, ...] = (
    "**/*.pyc",
    "**/*.pyo",
    "**/*.egg-info",
    "**/*.egg-info/**",
    # .copilot-instructions.md — written to the repo root by
    # src/prompt-builder.ts and committed via `git add .copilot-instructions.md`
    # before step-1 runs. It is orchestrator scaffolding, not agent work.
    # Without this exclude it appears in every SWE-bench patch and breaks
    # `git apply` in the /testbed container (smoke8 failure mode).
    ".copilot-instructions.md",
)


def git_pathspec_excludes() -> list[str]:
    """Return git pathspec :(exclude) directives covering every reserved path.

    For each directory entry, emits both the top-level form (`:(exclude)runs`)
    and a tree glob (`:(exclude)runs/**`). Git requires both when the
    exclude should match the directory itself AND everything under it; the
    top-level form alone can miss deeply nested files on some git versions.

    Consumers pass this list directly as trailing arguments to `git add`
    after a positive pathspec (typically `.`).
    """
    specs: list[str] = []
    for p in ORCHESTRATOR_RESERVED_PATHS + BUILD_ARTIFACT_RESERVED_PATHS:
        specs.append(f":(exclude){p}")
        specs.append(f":(exclude){p}/**")
    specs.extend(f":(exclude){pat}" for pat in _FILE_GLOB_EXCLUDES)
    return specs
