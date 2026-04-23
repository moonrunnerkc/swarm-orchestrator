# Phase 2 Decomposition Conventions

These conventions are binding for every extraction in Phase 2 (2a, 2b, 2c). They lock the pattern so the three sessions produce consistent structure.

If anything here conflicts with `docs/decomposition-plan.md`, the plan wins. If anything here conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

## 1. File location

- All modules extracted from `src/swarm-orchestrator.ts` go under `src/orchestrator/`.
- Modules extracted from other parents follow the same rule: `src/<parent-name>/<module>.ts` (examples already named in the plan: `src/plan-generator/`, `src/session-executor/`, `src/dashboard/`, `src/mcp/`, `src/cli/swarm/`, `src/cli/status/`).
- Do not place extracted modules at the top level of `src/`. They belong inside the parent module's directory so the ownership boundary is visible in the file tree.

## 2. Naming

- Kebab-case filenames: `pause-controller.ts`, not `PauseController.ts` or `pauseController.ts`.
- The filename must match the module name in the plan exactly. No renaming during extraction.
- Test files for extracted modules (if added) use the same kebab-case name: `test/pause-controller.test.ts`.

## 3. Host interface pattern

For any extraction that needs orchestrator collaborators (scheduler, step-executor, remediation, replan):

- Define a narrow interface in the **same file** as the extracted module:
  ```ts
  export interface SchedulerHost {
    executeStepInSwarm(step: PlanStep, agent: AgentProfile, context: SwarmExecutionContext, options?: SwarmExecutionOptions): Promise<void>;
    mergeWaveBranches(...): Promise<void>;
    // only the methods this module needs, nothing more
  }
  ```
- `SwarmOrchestrator` implements the interface naturally via its existing thin-delegate methods. No separate adapter class, no type-assertions.
- The extracted module receives the interface as its `host` parameter, not the orchestrator instance and not a bag of bound methods.
- **Do not** pass `this` or the orchestrator instance. **Do not** pass an object like `{ executeStep: orch.executeStepInSwarm.bind(orch), ... }` — that has no compile-time check for missing methods.
- If you need additional state (e.g. `workingDir`), add it to the interface explicitly:
  ```ts
  export interface SchedulerHost {
    readonly workingDir: string;
    executeStepInSwarm(...): Promise<void>;
  }
  ```

## 4. Thin delegate pattern on SwarmOrchestrator

Every method that existed before extraction stays on the class with the same name, signature, and accessibility. The body becomes a one-line call into the extracted module.

Example (reference, from existing code at `src/swarm-orchestrator.ts:1775-1799`):
```ts
private runCriticReview(completedResults: ParallelStepResult[], _context: SwarmExecutionContext, plan: ExecutionPlan): CriticResult {
  return _runCriticReview(completedResults, plan);
}
```

This preserves test access via `(orch as any).<method>`. No test changes required.

Import the extracted symbols with an underscore prefix alias to avoid name collision:
```ts
import { runAsyncMetaAnalysis as _runAsyncMetaAnalysis } from './orchestrator/async-meta-analysis';
```

## 5. JSDoc

Every exported symbol (function, class, interface, type) gets full JSDoc matching the style used in `src/post-run-reporter.ts`:

- One-line summary on the first line.
- Blank line, then longer description if non-obvious.
- `@param <name>` for each parameter.
- `@returns` for functions that return a value (omit for `void`).
- `@throws` when applicable.

Internal (unexported) helpers can carry a lighter 1-2 line comment when the why is not obvious. No comment is better than a comment that only restates what the code does.

## 6. Named exports only

- No `export default`.
- Match the CLAUDE.md rule: named exports are the project convention.
- If the parent file had a default export, preserve it there (do not change the parent's public API). Extracted modules are pure named exports.

## 7. Type discipline

- No `any`. Ever.
- If a type is genuinely unknown at a boundary, use `unknown` and narrow with a type guard or schema check.
- Do not tighten types that weren't tight before. This is a pure refactor; type-widening or -narrowing beyond what was there is out of scope.
- Do not add new type exports to the parent file's public surface. Types the extracted module needs internally stay internal.

## 8. Behavior preservation

- No renaming of local variables, no restructuring of control flow, no "while I'm here" fixes.
- If you see a bug or a smell, write it to `docs/phase-2a-observations.md` (Phase 2a) or the equivalent for later phases. Keep moving.
- Log messages (including emoji, whitespace, exact wording) are preserved verbatim. Some tests assert on them.
- Order of side effects preserved. If the original block wrote `metrics.json` before `session-state.json`, the extracted module writes them in the same order.

## 9. Import ordering in the parent

After extraction, the parent file's imports follow the existing ordering convention visible in `src/swarm-orchestrator.ts`:

1. Node built-ins.
2. Third-party packages.
3. Local modules from sibling directories.
4. Local modules from subdirectories (including the new `orchestrator/*`).

Underscore-prefixed import aliases (for delegated functions) group with their neighbors, not separately.

## 10. Commits

- One commit per extraction. One logical change per commit.
- Commit message format: `refactor: extract <module> from <parent>`.
- Commit body includes: lines moved, parent file size before/after, test count before/after.
- No skipping of hooks (`--no-verify` is forbidden unless the user explicitly requests it).
- If a pre-commit hook fails, diagnose and create a NEW commit. Do not amend.

## 11. The three-command gate

After every extraction commit:

```
npm test
npm run build
npx madge --circular src/
```

All three must pass. `madge` must report zero circular dependencies. Halt per the Phase 2 prompt if any fails and cannot be resolved in 15 minutes.
