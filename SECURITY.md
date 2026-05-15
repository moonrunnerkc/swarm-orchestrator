# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately via
[GitHub Security Advisories](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories/new)
rather than opening a public issue.

## Secret Handling

All credentials must be passed as environment variables. The orchestrator
never reads secrets from config files, CLI arguments, or `with:` inputs.

| Secret | Required For | Scope |
|--------|-------------|-------|
| `ANTHROPIC_API_KEY` | `--extractor anthropic` / `--session anthropic` | Anthropic API access |
| `OPENAI_API_KEY` | Codex falsifier (`src/falsification/adapters/profiles/codex.ts`) | OpenAI API access |
| `GITHUB_TOKEN` | Copilot falsifier (`src/falsification/adapters/profiles/copilot.ts`), PR creation | Repo contents + PRs only |

### GitHub Actions Usage

Always pass secrets via the `env:` block, never via `with:` inputs:

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v9
  with:
    goal: "Your goal here"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Always set minimal workflow permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

### Credential Policies

- Use fine-grained GitHub PATs with only `contents:write` and
  `pull-requests:write`. Set expiry to 30 days or less.
- Rotate API keys on a regular cadence (30-90 days).
- Never commit `.env`, key files, or credentials to the repository.
- Session artifacts (transcripts, session state) are automatically
  redacted for known secret values at the end of every run.

### Cloud Code / Google Cloud

- Preferred: Workload Identity Federation (zero static secrets).
- Fallback (only if WIF is impossible): Short-lived service-account
  keys (1 hour max) passed via GitHub Secrets. Long-lived JSON key
  files are deprecated and should not be used.

## .gitignore

Verify the following patterns are present in `.gitignore`:

```
.env*
*.key
*.pem
service-account*.json
```
