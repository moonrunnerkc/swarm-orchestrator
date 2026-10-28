# Decisions

One line per open choice made during the verifier-first rebuild (ADR 0014), with the reason.

- The recovery proposal file was not found on this machine; the rebuild prompt is the sole specification, as that prompt already takes precedence over the proposal.
- Rebuilt from the PR #101 head (cce83b6de), the newest line of history, on branch `rebuild/verifier-first`; `v13-main` is left untouched.
- Uncommitted agent-instruction loading work found in the checkout was preserved on branch `wip/agent-instructions-loading` before the rebuild started.
- `check-caps.mjs` runs as `npm run caps` from Phase 1 and joins `npm run gates` in the commit where it first passes, so every commit stays green as required.
- Phase 1 steps 1.1 to 1.4 landed as one commit: deleting src/eval broke src/select, which broke the CLI, so no smaller cut was green on its own.
- The old agent run path was deleted in the Phase 1 cut instead of being repaired around the deleted layers; `run` is absent until the Phase 2 loop lands.
- Phase 3 (verifier) was built before Phase 2 (loop), so the loop calls the real verifier from its first commit instead of an interim one.
- Research scripts beyond the five named directories, and dated research documents, were archived too: they import the deleted evidence checks and describe retired experiments.
- `.gitignore` was rewritten to the rules that still apply; its unanchored `DECISIONS.md` rule would have hidden this file.
- `scratchpad/` is ignored rather than deleted: it holds the owner's local logs.
- The ignored local research data under campaign/, redteam/ and docs/evidence/ was moved (not deleted) into the archive checkout beside its committed counterparts.
- The scrub regression inputs from fuzz/findings moved to src/evidence/fixtures/scrub-findings because the scrubber survives.
- Three legacy bundles moved to src/fixtures/legacy-bundles so the old-format verifier tests stay real until Phase 3 deletes that format.
- Runtime dependencies cut to smol-toml and zod: the Vercel AI SDK packages and undici go with src/providers, since the new loop speaks the OpenAI-compatible chat API over Node's fetch.
- The policy drift check and instruction sync were deleted in the Phase 1 cut rather than step 1.6: the drift check imported the deleted predicate catalogue.
- src/swarm-verify-boundary.test.ts fell out of the Phase 1 cut with the modules it named; Phase 3 restores the closure rule as a build-time check in the verifier's build.
- Product documentation for removed commands (cli, using, verifying, verify-only, agent, build guide, security coverage, claims, examples, engineering policy) was deleted in the cut; README, integrations and results pages replace it.
- ADRs 0012 and 0013 were archived with 0001 to 0011, so the ADR index is the archive pointer plus 0014 alone.
