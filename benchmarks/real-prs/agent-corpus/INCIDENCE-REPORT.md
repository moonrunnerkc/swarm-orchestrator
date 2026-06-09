# Agent-PR cheat incidence (pilot): classification pending

The corpus and audit stages are complete; the dual-arbiter classification
has not run yet (it needs two LLM arbiters), so **no incidence number is
claimed here**. Run `npm run agent-incidence:arbiter` then
`npm run agent-incidence:report` to produce the measured headline.

- **Corpus:** 60 merged agent-attributed PRs fetched at 2026-06-09T19:53:12.841Z (devin: 10, claude-code: 12, cursor: 10, codex-cli: 10, copilot-workspace: 10, aider: 8).
- **Audit:** 60 PRs audited with the default product configuration; 228 unclassified findings.
- Queries, caps, and drop counts are in `sources.json`; per-PR findings in `audit-results/`.
