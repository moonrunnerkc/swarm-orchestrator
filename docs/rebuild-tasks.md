# Rebuild task list

Marked `[x]` when finished and committed. On resume, continue from the first `[ ]`.

## Phase 1: cut
- [x] 1.2 Delete weight, cited-bundle, corpus-history, evidence-pack, CI-verdict checks; rewrite `checks`
- [x] 1.1 Archive evidence, campaign, redteam, fuzz, history, ADRs 0001-0011, research scripts
- [x] 1.3 Delete workers, cli-parallel, select, eval, tui, install; drop ink/react/playwright/jazzer
- [x] 1.4 Reduce subcommands to run, verify, init, ci, doctor; docs/integrations.md
- [x] 1.5 Reduce workflows to ci.yml, release.yml, nightly-eval.yml stub
- [x] 1.6 Squash CHANGELOG history, ADR 0014, one CLAUDE.md with AGENTS.md copy
- [x] 1.7 scripts/check-caps.mjs (`npm run caps`)

## Phase 2: agent loop
- [ ] 2.1 src/agent/ single bash tool loop (at most five files, 500 lines)
- [ ] 2.2 Delete the controller and mid-run gates; trim swarm.toml config

## Phase 3: verifier
- [ ] 3.1 src/verify/ checkout, apply, protected paths, declared checks
- [ ] 3.2 Held-out checks (`swarm init --seal`)
- [ ] 3.3 Changed-line coverage and mutation witness
- [ ] 3.4 in-toto Statement, DSSE, ed25519 and cosign signing; verify.mjs
- [ ] 3.5 Tamper demo and node:24 clean-container demo under docs/demos/
- [ ] 3.6 Five surfaces call one path; caps pass and join gates

## Phase 4: evaluation
- [ ] 4.1 eval/ runner, frozen task lists, three arms
- [ ] 4.2 eval/report.mjs and docs/results.md; delete number-asserting pages
- [ ] 4.3 eval/tamper generator and runner; table in docs/results.md
- [ ] 4.4 nightly-eval.yml
- [ ] 4.5 Smoke run and full tamper run

## Phase 5: front door
- [ ] 5.1 README under 120 lines
- [ ] 5.2 Package descriptions, 15.0.0 and swarm-verify 2.0.0 unreleased

## Definition of done
- [ ] All thirteen checks hold; final report
