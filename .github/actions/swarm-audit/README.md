# swarm-audit (composite action)

Pin-and-go GitHub Action that runs `swarm audit` against a pull request,
posts the rendered findings as a PR comment, and fails the check when
any blocking cheat pattern is detected.

## Use

```yaml
name: PR audit
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  pull-requests: write
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: moonrunnerkc/swarm-orchestrator/.github/actions/swarm-audit@v10
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          # Optional: emit a procurement-ready AI-BOM artifact.
          emit-aibom: cyclonedx-ml
```

## Inputs

| Name | Default | Purpose |
|---|---|---|
| `pr` | inferred from event | PR ref: `owner/repo#NN`, URL, or bare number. |
| `emit-aibom` | _empty_ | `cyclonedx-ml` \| `spdx-ai` \| `both`. |
| `comment` | `true` | Post the rendered Markdown as a PR comment. |
| `repo-root` | `$GITHUB_WORKSPACE` | Repo root for manifest / import lookups. |
| `node-version` | `20` | Node version for `setup-node`. |

## Outputs

| Name | Meaning |
|---|---|
| `pass` | `true` when no blocking findings. |
| `blocking-findings` | Count of blocking findings. |
| `ledger` | Path to the JSONL evidence ledger. |

## Required permissions

```yaml
permissions:
  pull-requests: write   # to post the audit comment
  contents: read         # to read the diff
```
