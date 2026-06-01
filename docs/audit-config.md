# Audit configuration

`swarm audit` reads `.swarm/audit-config.yaml` at the repo root when present.
Both supported keys are optional; an absent file means default behavior.

## `excludePaths`

A list of glob patterns exempted from cheat detection in addition to the
engine's built-in subject-path filter. Useful for repos whose source code
legitimately contains literal cheat patterns: detector tests with embedded
fixture diffs, rule packs that quote `if (false)` as documentation, generator
scripts that emit broken patches by design.

```yaml
excludePaths:
  - test/fixtures/**
  - benchmarks/**
  - scripts/generate-broken-*.ts
```

Glob syntax: `*` matches one path segment except `/`, `**` matches any number
of segments. Anchored at the repo root unless the pattern starts with `**/`.
Patterns are case-sensitive.

## `intentSeverityPolicy`

Controls the PR-intent severity-upgrade layer.

```yaml
intentSeverityPolicy: strict   # default
```

Possible values:

- `strict` (default): when the PR title or body claims a fix (GitHub
  close-keyword with `#N`, imperative `fix:` / `resolves:` / `closes:` title,
  or a leading "This PR fixes/resolves/closes" sentence), `warn` findings
  escalate to `block` and `info` findings escalate to `warn`. `block` stays
  `block`.
- `lenient`: `warn` still escalates to `block` when a fix is claimed, but
  `info` is left alone. Use this if you want to take fix-claim PRs more
  seriously without flipping the noisy informational findings into warnings.
- `off`: the intent layer never runs. Severities come straight from the
  detectors with no escalation.

When an upgrade fires, the affected finding's message gets a trailing
sentence quoting the matched evidence:
`Severity raised because the PR claims a fix ("fixes #42").` The PR-comment
renderer also prints one line at the top of the comment listing the upgraded
categories.

Recognized fix-claim vocabularies (case-insensitive):

| Source | Pattern | Example |
|---|---|---|
| title or body | `(fix\|fixes\|fixed\|close\|closes\|closed\|resolve\|resolves\|resolved\|patches\|patched\|addresses\|addressed) #N` | `fixes #123` |
| title prefix | `^(fix\|fixes\|fixed\|resolve\|resolves\|resolved\|close\|closes\|closed):` | `fix: payment bug` |
| body lead (first 500 chars) | `(this PR (fixes\|resolves\|closes))` | `This PR fixes the timeout` |

## `judgePrimary`

Controls the judge-primary path that catches the two semantic cheat
categories (`goal-not-fixed`, `cheat-mock-mutation`) no structural detector
keys on. The judge is asked whether the diff delivers the PR's stated
claim; a "no" raises a finding.

```yaml
judgePrimary:
  enabled: true
  categories: [goal-not-fixed, cheat-mock-mutation]
```

Default: `enabled: true`, both categories. The path only fires when the
judge is enabled (`--enable-llm-judge` / `SWARM_AUDIT_LLM_JUDGE=1`), so the
no-credentials default audit is unchanged.

**Migrating / opting out.** Cost-sensitive consumers disable it:

```yaml
judgePrimary:
  enabled: false
```

With it on, expect roughly two extra judge calls per PR (about $0.009 at
Anthropic Haiku list price) and about 10 percentage points of added
false positives on presumed-clean PRs (see
`benchmarks/results/AB-REPORT.md`). `swarm doctor` warns when it is enabled
with no inference provider configured and errors on an unknown category.

## Example

```yaml
# .swarm/audit-config.yaml
excludePaths:
  - test/fixtures/**
intentSeverityPolicy: strict
judgePrimary:
  enabled: true
  categories: [goal-not-fixed, cheat-mock-mutation]
```
