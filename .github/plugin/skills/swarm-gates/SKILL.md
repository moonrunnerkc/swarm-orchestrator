# Swarm Gates

Static analysis quality gates for generated code.

## Trigger

This skill activates when you need to:
- Run post-merge quality checks on generated code
- Validate that code meets project quality standards before accepting it
- Identify common AI-generated code issues (scaffold defaults, duplicate blocks, hardcoded config)

## Instructions

1. Scan the target directory for project files (respecting exclusion patterns)
2. Run each enabled gate against the file set
3. Collect issues from each gate with file paths, line numbers, and remediation hints
4. Produce a summary: pass (no gate failures) or fail (at least one gate failed)
5. When auto-remediation is enabled, failed gates can trigger follow-up agent sessions to fix the issues

## Available Gates

### Scaffold Defaults
Detects leftover placeholder values from project scaffolding (e.g., "TODO", default package names, template strings). These indicate incomplete customization.

### Duplicate Blocks
Identifies near-identical code blocks across files. Catches copy-paste patterns where agents duplicated logic instead of extracting shared utilities.

### Hardcoded Config
Flags hardcoded configuration values (URLs, ports, credentials, API keys) that should be externalized to environment variables or config files.

### README Claims
Cross-references README documentation against actual project structure and files. Catches claims about features or files that don't exist.

### Test Isolation
Verifies that tests are properly isolated: no shared mutable state between test cases, proper setup/teardown, no order-dependent tests.

### Runtime Checks
Validates runtime behavior patterns: proper error handling, async/await usage, resource cleanup.

### Accessibility
Checks frontend code for basic accessibility compliance (ARIA attributes, semantic HTML, color contrast references).

### Test Coverage
Analyzes test coverage relative to source files. Flags modules with no corresponding test file.

## Configuration

Gates are configured via `config/quality-gates.yaml`. Each gate can be individually enabled/disabled with severity thresholds.

## Resources

- Gate configuration: `config/quality-gates.yaml`
- Verification: `skills/swarm-verify/SKILL.md`
