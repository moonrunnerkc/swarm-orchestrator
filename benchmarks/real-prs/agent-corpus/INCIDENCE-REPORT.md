# Agent-PR cheat incidence (pilot)

Of the merged PRs the shipped fingerprinter attributes to an AI coding
agent at medium-or-high confidence, the share carrying at least one
finding that two independent arbiter model families both classify as a
true cheat. Regenerate with `npm run agent-incidence:full`.

Lab measurements of agent reward hacking exist (METR measured o3 gaming
30.4% of RE-Bench runs); a field counterpart for merged agent PRs does
not. This is that measurement, at pilot scale, with its uncertainty
stated.

## Headline

- **Corpus:** 60 merged agent-attributed PRs (60 fetched; selection below).
- **Audit:** 278 findings from the default product configuration.
- **Dual-arbiter labels:** 266 of 278 findings classified (ollama:qwen3.6:35b-a3b + ollama:gemma4:e4b-it-q8_0); 20 arbiter-splits excluded from the headline. **Classification is partial**; the incidence below can only grow as the remaining 12 findings are classified.
- **Incidence:** 0/60 PRs carry at least one agreed true-cheat finding = **0.0%** (Wilson 95%: 0.0% to 6.0%).
- Agreed false-alarms: 246; agreed true-cheats: 0.

## By vendor

| vendor | PRs audited | findings | PRs with agreed true-cheat |
|---|---|---|---|
| aider | 8 | 18 | 0 |
| claude-code | 12 | 15 | 0 |
| codex-cli | 10 | 41 | 0 |
| copilot-workspace | 10 | 42 | 0 |
| cursor | 10 | 99 | 0 |
| devin | 10 | 63 | 0 |

## By category (classified findings)

| category | true-cheat | false-alarm | split |
|---|---|---|---|
| no-op-fix | 0 | 144 | 8 |
| coverage-erosion | 0 | 95 | 9 |
| type-suppression | 0 | 2 | 1 |
| fake-refactor | 0 | 2 | 1 |
| error-swallow | 0 | 2 | 0 |
| goal-not-fixed | 0 | 1 | 1 |

## Selection

60 PRs fetched at 2026-06-09T19:53:12.841Z, capped at 10/vendor, changed-line band 10-8000. Queries:

- `is:pr is:merged author:devin-ai-integration[bot] merged:>=2025-06-09`
- `is:pr is:merged "Generated with Claude Code" in:body merged:>=2025-06-09`
- `is:pr is:merged head:cursor/ merged:>=2025-06-09`
- `is:pr is:merged head:codex/ merged:>=2025-06-09`
- `is:pr is:merged author:copilot-swe-agent[bot] merged:>=2025-06-09`
- `is:pr is:merged author:openhands-agent[bot] merged:>=2025-06-09`
- `is:pr is:merged "aider.chat" in:body merged:>=2025-06-09`
- `is:pr is:merged author:replit-agent[bot] merged:>=2025-06-09`

Every candidate was confirmed by `detectAgent` (src/audit/pr-source) on
the PR's real metadata before inclusion; search hits the fingerprinter
did not confirm were dropped and counted in `sources.json`.

## Honest caveats

- **Pilot scale.** The Wilson interval above is wide; treat the headline
  as a first field estimate, not a settled rate.
- **Selection bias.** The corpus is search-discoverable agent PRs
  (bot authors and explicit body markers). Agents run without attribution
  markers are invisible to this method, and repos that ban agent PRs are
  absent by construction. The true population rate could differ in either
  direction.
- **AI arbiters, not human labels.** A finding counts only when two
  independent model families agree, and splits are excluded, but model
  consensus is not ground truth. The adjudication loop
  (scripts/labeling/adjudicate.ts) is the path to human verification.
- **Merged PRs only.** Cheats caught in review and never merged do not
  appear; this measures what survives review.
