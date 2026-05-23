---
description: Audit the current branch (or a specific PR) for AI-agent cheat patterns. Wraps `swarm audit` and renders the result.
---

# Swarm Audit

Runs the v10 swarm-audit cheat-detector engine and reports findings.

## What this command does

1. If called with an argument (a PR number, `owner/repo#NN`, or a GitHub PR URL), audits that PR via the GitHub API.
2. Otherwise, generates a diff of the current branch against `main` (or the user's specified base) and audits it locally.
3. Posts a summary to chat with the same shape as the Markdown PR comment the GitHub Action posts.

## Usage

```text
/swarm-audit                 # audit current branch vs main
/swarm-audit 123             # audit PR #123 in the current repo
/swarm-audit owner/repo#123  # audit a PR in any repo
```

## Implementation

```bash
# 1) Resolve the argument.
ARG="$1"

# 2) Run swarm audit with the appropriate input mode.
if [ -z "$ARG" ]; then
  git diff main...HEAD | npx swarm audit --diff-stdin --output markdown
elif [[ "$ARG" =~ ^[0-9]+$ ]]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  npx swarm audit "${REPO}#${ARG}" --output markdown
else
  npx swarm audit "$ARG" --output markdown
fi
```

## Exit codes

- `0` — no blocking findings, PR is mergeable.
- `1` — blocking finding caught. Read the rendered Markdown and fix
  the flagged hunk(s) before pushing.

## Notes

- Requires `GITHUB_TOKEN` in the env for PR fetches; unauthenticated
  requests work but hit the public 60/hour rate limit.
- The cheat-detector engine is independent of the orchestrator's
  contract-first rule system. Audit can run against any diff without
  a `contract.yaml`.
