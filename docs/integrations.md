# Integrations

Every surface calls the same verifier through its command line. There is no second
implementation behind any of them: the GitHub Action, a pre-commit hook, an MCP client and a
CI job all run `swarm-verify ci` on a change and read its exit code and report.

## GitHub Action

The manifest is at `packages/swarm-verify/action.yml`. It installs the verifier and runs it on
the pull request's change against its base. Check out the full history first so the base
commit is present.

```yaml
on: pull_request
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: moonrunnerkc/swarm-orchestrator/packages/swarm-verify@main
```

## Any CI job

```sh
npx --yes swarm-verify ci --branch HEAD --base "$BASE_SHA"
```

The exit code is the verdict: 0 when the change verified, 1 when it did not, 2 for a command
line the verifier cannot read.

## pre-commit

A local hook in `.pre-commit-config.yaml` verifies the staged change against `HEAD`:

```yaml
repos:
  - repo: local
    hooks:
      - id: swarm-verify
        name: swarm-verify
        entry: sh -c 'git diff --cached > .git/swarm-staged.patch && npx --yes swarm-verify ci --patch .git/swarm-staged.patch'
        language: system
        pass_filenames: false
```

## MCP clients and agent hooks

An MCP client or an agent's hook runs the same command through whatever command tool it
already has; nothing else is needed. For a Claude Code `Stop` hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "git diff HEAD > /tmp/swarm.patch && npx --yes swarm-verify ci --patch /tmp/swarm.patch" }
        ]
      }
    ]
  }
}
```
