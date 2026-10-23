# Intended files, controller progress stage

Declared on October 23, 2026, before any source edit of this stage, on branch
`feat/progress-observations-2026-10-23` (stacked on draft PR 97, head `fa190998c`). Additional
files are recorded below as dated amendments before they are edited.

## Product

- `src/core/working-state.ts`, `src/core/working-state.test.ts`: checks kept apart from
  inspections, per-subject outcomes, shell writes in the working-state generation, tool errors and
  unmeasured effects kept as uncertainty, the revised decision rule.
- `src/core/loop.ts`, `src/core/loop.test.ts`: a bounded follow-up decision after an
  intervention, inside the loop's own allowance.
- `src/agent-decision-point.ts`, `src/agent-decision-point.test.ts`: retrieval only of names no
  search found, reassessment of an intervention whose intended outcome did not occur, a validated
  implementation action, intervention limits and cost accounting.
- `src/agent-run.ts`, `src/agent-run.test.ts`: wiring of the workspace-effect measurement, the
  classifier and the edit notices.
- `src/tools/shell-command.ts`, `src/tools/shell-command.test.ts`: separators kept with their
  operator, so a pipeline's last stage is known.
- `src/tools/shell-observation.ts`, `src/tools/shell-observation.test.ts` (new): which shell
  commands are inspections and which are checks, and a check's subject.
- `src/gates/scratch-index.ts`, `src/gates/scratch-index.test.ts`: a workspace tree identity held
  across measurements.
- `src/agent-workspace-effects.ts`, `src/agent-workspace-effects.test.ts` (new): the measured
  effect of each shell command on the workspace, and references a move or deletion left behind.
- `src/tools/file-tools.ts`, `src/tools/file-tools.test.ts`: a scoped batch of edits in one call.
- `src/agent-edit-notices.ts`, `src/agent-edit-notices.test.ts` (new): an edit that stops using an
  existing implementation is named, with the task's preservation statements.

## Experiment harness

- `scripts/comparison/*`: only where the study needs it, recorded here first.

## Documentation and evidence

- `docs/adaptive-problem-solving.md`: revised behavior and limitations.
- `README.md`: one short link.
- `docs/evidence/2026-10-23-controller/`: reproductions, trace reconstruction, protocols,
  selection rule, records, scores and report.

## Amendment 1, October 23, 2026, before editing these files

- `scripts/comparison/launch-config.mjs`, `scripts/comparison/launch-config.test.mjs`,
  `scripts/comparison/study.mjs`, `scripts/comparison/workspace.mjs`: a `swarm-previous` arm whose
  pinned build may differ from the other Swarm arms' (its own CLI path, CLI digest and build-tree
  digest, frozen and validated like the main pin), so the development study compares the current
  and the revised implementation in one manifest and one interleaved order. Scoring keeps using
  the manifest's main pinned build for every arm.

## Amendment 2, October 23, 2026, before editing this file

- `src/cli-options.ts`: the `--adaptive` help line and option comment name the revised rule and its
  follow-up.

## Amendment 3, October 23, 2026, before editing these files

- `src/config/package-discovery.ts`, `src/config/package-discovery.test.ts`: a `pnpm-workspace.yaml`
  that carries settings only (no top-level `packages` key, which pnpm 9 and later allow) is a
  single-package project, not an unreadable workspace. Found by the fresh block's preflight: svgo's
  file holds only `minimumReleaseAge` and `patchedDependencies`, and Swarm refused to choose a scope,
  so it ran no check at all.
