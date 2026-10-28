# Integrations

Every surface runs the same verifier through its command line; there is no second
implementation behind any of them. Each run writes `attestation.sigstore.json` (a DSSE envelope
in a Sigstore bundle), `change.patch` and `attestation.pub.pem` to `.swarm/verify/` (or
`--out`), prints the verdict, and exits 0 for pass, 1 for fail, 2 for a command line it cannot
read and 4 when nothing was measured.

## Command line

```sh
npx swarm-verify verify                          # the working tree against HEAD
npx swarm-verify verify --range main..feature    # a ref range
npx swarm-verify verify --patch change.diff      # a patch file against HEAD (or --base)
```

## GitHub Action

The manifest is `packages/swarm-verify/action.yml`. It runs `swarm-verify ci`, which verifies
`HEAD` against the merge base with the pull request's base branch and adds the verdict to the
job summary. Check out the full history so the base is present.

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

## Any other CI system

```sh
npx --yes swarm-verify ci --base origin/main
```

## pre-commit

A local hook in `.pre-commit-config.yaml` verifies the staged change against `HEAD`:

```yaml
repos:
  - repo: local
    hooks:
      - id: swarm-verify
        name: swarm-verify
        entry: sh -c 'git diff --cached --binary > .git/swarm-staged.patch && npx --yes swarm-verify verify --patch .git/swarm-staged.patch'
        language: system
        pass_filenames: false
```

## MCP clients and agent hooks

An MCP client or a coding agent runs the same command through the command tool it already
has; nothing else is needed. A Claude Code `Stop` hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx --yes swarm-verify verify" }] }
    ]
  }
}
```

`swarm run` calls the verifier in-process on its own working tree; see the README.
