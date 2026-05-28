# Wild PR Scan — Summary

Generated: 2026-05-28T01:48:48.019Z

## Totals

- PRs audited: **48**
- Passed (no blocking findings): **44**
- PRs with at least one finding: **34**
- PRs with warn-or-error findings: **29**
- PRs with blocking-grade findings: **32**
- Total findings: **481**

## Per repository

| Repo                   | PRs | Pass | Warn/Err | Blocking |
| ---------------------- | --- | ---- | -------- | -------- |
| RooCodeInc/Roo-Code    | 8   | 8    | 310      | 310      |
| sst/opencode           | 8   | 8    | 71       | 71       |
| All-Hands-AI/OpenHands | 8   | 6    | 10       | 28       |
| paul-gauthier/aider    | 8   | 7    | 14       | 16       |
| continuedev/continue   | 8   | 8    | 15       | 15       |
| cline/cline            | 8   | 7    | 7        | 8        |

## Per detected agent

| Agent        | PRs | Warn/Err | Blocking |
| ------------ | --- | -------- | -------- |
| unidentified | 48  | 427      | 448      |

## Per detector category (totals)

| Category              | Total findings |
| --------------------- | -------------- |
| no-op-fix             | 456            |
| mock-of-hallucination | 20             |
| error-swallow         | 5              |

## Top-ranked individual findings (first 25)

| Score | Severity | Category  | Repo#PR                   | File                                                       | Message                                                                          |
| ----- | -------- | --------- | ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | .github/workflows/docs-pages.yml                           | Source file .github/workflows/docs-pages.yml was modified but no test file in th |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/.env.example                                     | Source file apps/docs/.env.example was modified but no test file in the reposito |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/.gitignore                                       | Source file apps/docs/.gitignore was modified but no test file in the repository |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/LICENSE                                          | Source file apps/docs/LICENSE was modified but no test file in the repository im |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/advanced-usage/local-development-setup.mdx  | Source file apps/docs/docs/advanced-usage/local-development-setup.mdx was modifi |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/advanced-usage/roo-code-nightly.mdx         | Source file apps/docs/docs/advanced-usage/roo-code-nightly.mdx was modified but  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/api-configuration-profiles.mdx     | Source file apps/docs/docs/features/api-configuration-profiles.mdx was modified  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/auto-approving-actions.mdx         | Source file apps/docs/docs/features/auto-approving-actions.mdx was modified but  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/boomerang-tasks.mdx                | Source file apps/docs/docs/features/boomerang-tasks.mdx was modified but no test |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/checkpoints.mdx                    | Source file apps/docs/docs/features/checkpoints.mdx was modified but no test fil |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/code-actions.mdx                   | Source file apps/docs/docs/features/code-actions.mdx was modified but no test fi |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/codebase-indexing.mdx              | Source file apps/docs/docs/features/codebase-indexing.mdx was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/custom-modes.mdx                   | Source file apps/docs/docs/features/custom-modes.mdx was modified but no test fi |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/intelligent-context-condensing.mdx | Source file apps/docs/docs/features/intelligent-context-condensing.mdx was modif |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/marketplace.mdx                    | Source file apps/docs/docs/features/marketplace.mdx was modified but no test fil |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/mcp/using-mcp-in-roo.mdx           | Source file apps/docs/docs/features/mcp/using-mcp-in-roo.mdx was modified but no |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/shell-integration.mdx              | Source file apps/docs/docs/features/shell-integration.mdx was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/skills.mdx                         | Source file apps/docs/docs/features/skills.mdx was modified but no test file in  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/slash-commands.mdx                 | Source file apps/docs/docs/features/slash-commands.mdx was modified but no test  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/task-todo-list.mdx                 | Source file apps/docs/docs/features/task-todo-list.mdx was modified but no test  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/features/worktrees.mdx                      | Source file apps/docs/docs/features/worktrees.mdx was modified but no test file  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/getting-started/installing.mdx              | Source file apps/docs/docs/getting-started/installing.mdx was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/index.mdx                                   | Source file apps/docs/docs/index.mdx was modified but no test file in the reposi |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/providers/index.json                        | Source file apps/docs/docs/providers/index.json was modified but no test file in |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docs/providers/index.mdx                         | Source file apps/docs/docs/providers/index.mdx was modified but no test file in  |
