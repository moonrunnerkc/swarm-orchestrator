# Integrations

First-party hooks for the most common AI coding agent surfaces. Each
integration wraps `swarm audit` so the cheat-detector engine is
available wherever the agent runs.

## Claude Code (slash command)

Located at [`.claude/commands/swarm-audit.md`](../.claude/commands/swarm-audit.md).
Invoke with `/swarm-audit` (no args = current branch vs main) or
`/swarm-audit 123` (PR number) or `/swarm-audit owner/repo#123`.

## Cursor (rule pack)

Located at [`integrations/cursor/swarm-audit.mdc`](cursor/swarm-audit.mdc).
Copy or symlink into the consumer repo's `.cursor/rules/` directory.
The rules surface every cheat pattern inline so the Cursor agent
avoids them as it edits, rather than learning at merge time that the
PR is blocked.

## Aider (pre-commit hook)

Located at [`integrations/aider/pre-commit-swarm-audit`](aider/pre-commit-swarm-audit).
Drop into `.git/hooks/pre-commit` and `chmod +x`:

```bash
cp integrations/aider/pre-commit-swarm-audit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Audits the staged diff before each commit. Exits non-zero on a
blocking finding, which Aider surfaces to the agent so the next pass
can correct.

## GitHub Action

The first-class deliverable. Defined at the repo root
([`action.yml`](../action.yml)) and as a composite sub-action
([`.github/actions/swarm-audit/action.yml`](../.github/actions/swarm-audit/action.yml)).

See [the README's GitHub Action section](../README.md#github-action)
for the recommended workflow shape.
