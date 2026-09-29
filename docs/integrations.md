# Integrations: Claude Code, MCP clients and git

Three thin clients of the same verifier. Each invokes the installed `swarm-verify` binary and
writes the same evidence every other route writes; none carries verification logic of its
own, and none is needed to use the verifier. Install only the one you use. Every example below
is exercised by a real run in `src/integrations/*.test.ts`, and the client sessions recorded in
[the verifier-first index](verifier-first/README.md) name the client versions they ran against.

## Claude Code hook

When the agent runs the project's test command through its Bash tool, the hook rewrites that
one call to `swarm-verify check`, so the agent reads back the recorded assessment with its
evidence bundle rather than raw runner output, and the ledger holds what ran. The command is
replaced, not preceded: nothing runs twice. A call that already invokes the verifier passes
untouched, which is the recursion guard.

```sh
npx swarm-verify hook install              # .claude/settings.json in this project
npx swarm-verify hook install --scope user # ~/.claude/settings.json
npx swarm-verify hook uninstall
```

Installing adds two entries and touches nothing else in the file:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /path/to/swarm-verify.js hook run", "timeout": 900 }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /path/to/swarm-verify.js hook run", "timeout": 900 }] }
    ]
  }
}
```

Uninstalling removes exactly those two entries; a group they emptied is removed, a foreign
hook beside them is kept. The recognised commands are whole, exact forms: `npm test`, `npm run
test`, `pnpm test`, `yarn test`, `vitest`, `vitest run`, `npx vitest`, `jest`, `npx jest`,
`node --test`, `pytest`, `python -m pytest`, `uv run pytest` and their close spellings. One of
those piped only through `tail`, `head` or `grep` with plain arguments (with or without `2>&1`),
such as `npm test 2>&1 | tail -5`, is routed with the same filters kept. Any other argument,
pipeline stage, shell syntax or `cd` leaves the command alone. On `PostToolUse` the hook records
the verifier's result for the session under the session store, for a person who asks later;
it never blocks. The `Stop` event is not used: a hook that refuses to let the agent stop is
the loop the hook documentation warns about, and the ledger does not need it.

What it enforces, exactly: Bash tool calls in this Claude Code session that match a recognised
form. It does not see subagents' calls, MCP tools, alternate tools or a second terminal, and a
person who can edit the settings file can remove it. It routes ordinary verification through
the ledger; CI remains the boundary that authenticates work. Tested live against Claude Code
2.1.284.

Run as `npx swarm-verify hook install`, the installer writes `npx --yes swarm-verify@<version>`
as the command rather than a path inside npm's npx cache, which npm may clear; from a project
or global install it writes that install's path.

Behaviour on each outcome of the rewritten call: success and failure reach the agent as the
verifier's own output and exit code; cancellation is Claude Code's own for the Bash call; a
tool error (the verifier absent, the workspace not a repository) is the verifier's exit 4 with
the exact next step, and the hook itself never exits non-zero, so a broken hook cannot block
the agent.

## MCP server

A local server over stdio exposing three bounded operations, confined to the directory it is
started in and to the session store. It speaks the protocol directly (JSON-RPC 2.0,
newline-delimited, revisions 2024-11-05 through 2025-06-18) so the verifier carries no server
framework. No shell is exposed, no text a tool returns is read as an instruction, cancellation
ends the child the tool started, and every result is bounded.

| Tool | Does | Bounds |
| --- | --- | --- |
| `swarm_verify_check` | runs `check` over a workspace under the root, returns the `swarm.check.v1` report | workspace inside the root; package names plain and relative |
| `swarm_verify_status` | the last report this server produced for a workspace | none stored means `none` |
| `swarm_verify_evidence` | one file of a bundle: `manifest.json`, `summary.md`, `report.json`, `verdict.json`, `ledger.jsonl` | bundle under the session store or the root; 64 KB |

Claude Code:

```sh
claude mcp add --transport stdio swarm-verify -- npx -y swarm-verify mcp --root .
```

or in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "swarm-verify": { "type": "stdio", "command": "npx", "args": ["-y", "swarm-verify", "mcp", "--root", "."] }
  }
}
```

Cursor, in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "swarm-verify": { "type": "stdio", "command": "npx", "args": ["-y", "swarm-verify", "mcp", "--root", "."] }
  }
}
```

Exercised with Claude Code as the client; the Cursor configuration above has not been run
inside Cursor by the maintainer. Remove by deleting the entry (`claude mcp remove swarm-verify`
for Claude Code). The server
makes no model call and needs no account. `npx swarm-verify mcp --describe` prints the tool
catalogue without a session.

## Pre-commit hook

Verifies the staged tree and nothing else. The index is written to a tree, that tree becomes
an unreferenced commit on top of `HEAD`, a detached worktree of it is checked, and the working
tree's installed dependencies are borrowed by link and named as borrowed. Unstaged edits,
untracked files and the branch are never read and never touched: nothing is stashed, reset or
rewritten, and a partial commit's temporary index is honoured. The evidence is bound to the
staged tree's identity, so a later `git add` invalidates it by construction.

```sh
npx swarm-verify pre-commit install     # writes .git/hooks/pre-commit, or names the line to add to yours
npx swarm-verify pre-commit             # what the hook runs: verify the staged tree now
npx swarm-verify pre-commit uninstall   # removes the hook only where it is ours
```

With the pre-commit framework, in `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/moonrunnerkc/swarm-verify
    rev: v1.2.0
    hooks:
      - id: swarm-verify
```

The framework hook runs `npx --yes swarm-verify@<that version> pre-commit`, so it needs Node and
npm on PATH and fetches the pinned version once. Distributions before `v1.2.0` declared a
`node` hook that fails on npm 11 and runs the wrong binary on npm 10; use `v1.2.0` or later.

Exit codes are the check command's: 0 for a regression-only pass, 1 for a failed check, 4 for
an incomplete assessment; a commit is blocked on anything but 0. `git commit --no-verify`
skips the hook, a hook file is editable by whoever can commit, and neither fact is hidden: a
git hook is a convenience for the person committing, and CI remains the independent check.
The full verification path for CI is [the Action](broad-use.md#github-action).
