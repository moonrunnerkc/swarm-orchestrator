# Dogfood rollout manifest

Inventory taken 2026-09-27 from authenticated GitHub metadata (`gh repo list`) for the account
`moonrunnerkc` and the organization `Aftermath-Technologies-Ltd`, where that account holds the
admin role. Ownership basis is the metadata itself, never a website name.

Selection rule, recorded before any rollout: a repository is in scope when it is not a fork,
not archived, public, and pushed within the 365 days before the inventory date. Forks are
recorded as inapplicable because their work is not the owner's. Private repositories are
recorded as inapplicable for the open-source rollout, except the Aftermath site repository,
which is in scope by name whatever its visibility. Empty repositories and repositories with no
discoverable check are recorded with that reason.

## The Aftermath site repository

The live site at `https://aftermathtech.com` serves static HTML from an nginx host with a PHP
module; its markup references `/assets/css/styles.css` and carries no Next.js, WordPress or
Astro markers. The only repository whose metadata names the Aftermath site is
`moonrunnerkc/aftermathtech` (private, **archived** since 2025-07-24, a Next.js application
whose README calls itself the official website and whose recorded homepage is
`aftermathtech.vercel.app`). The live markup is not that application's output. No other
repository under either account carries the live site's markup, and no local checkout does.

The exact repository behind the live site is therefore not identifiable from authorized
metadata: the named candidate is archived and superseded by content that lives outside any
repository this account holds. Per the assignment, this ambiguity is resolved only after the
rest of the inventory and authorized work is complete, and it is left open here rather than
guessed. The archived candidate cannot receive a workflow without unarchiving it, which is an
owner decision, not an incidental effect of this rollout.

## Owned public repositories in scope

| Repository | Default branch | Language | Pushed | Existing checks | Intended verified scope | Workflow | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| moonrunnerkc/swarm-orchestrator | v13-main | TypeScript | 2026-09-27 | gates, action-controls, nightly proof | full gates | to be added | pending |
| moonrunnerkc/tracemantle | main | Python | 2026-09-13 | to inspect | project tests | to be added | pending |
| moonrunnerkc/dumpscan | main | TypeScript | 2026-09-04 | to inspect | project tests | to be added | pending |
| moonrunnerkc/crossfire | main | TypeScript | 2026-08-18 | to inspect | project tests | to be added | pending |
| moonrunnerkc/cronproof | main | TypeScript | 2026-07-29 | to inspect | project tests | to be added | pending |
| moonrunnerkc/quantproof | main | TypeScript | 2026-07-19 | to inspect | project tests | to be added | pending |
| moonrunnerkc/gemma-witness | main | Rust | 2026-07-10 | to inspect | see note | to be added | pending |
| moonrunnerkc/nondet | main | Java | 2026-06-30 | to inspect | see note | to be added | pending |
| moonrunnerkc/claimcheck | master | TypeScript | 2026-06-03 | to inspect | project tests | to be added | pending |
| moonrunnerkc/pubprep | main | TypeScript | 2026-05-23 | to inspect | project tests | to be added | pending |
| moonrunnerkc/ruleprobe | main | TypeScript | 2026-05-23 | to inspect | project tests | to be added | pending |
| moonrunnerkc/rlfusion-orchestrator | main | Python | 2026-05-21 | to inspect | project tests | to be added | pending |
| moonrunnerkc/counterfactual-court | main | TypeScript | 2026-05-08 | to inspect | project tests | to be added | pending |
| moonrunnerkc/swarm-orchestrator-rules | main | none | 2026-05-01 | to inspect | see note | to be added | pending |
| moonrunnerkc/nborder | main | Python | 2026-04-27 | to inspect | project tests | to be added | pending |
| Aftermath-Technologies-Ltd/depose | main | TypeScript | 2026-09-05 | to inspect | project tests | to be added | pending |
| Aftermath-Technologies-Ltd/ironroot | main | Python | 2026-05-12 | to inspect | project tests | to be added | pending |

Notes: `gemma-witness` (Rust) and `nondet` (Java) are outside the verifier's Node and Python
discovery; their rows stay in the manifest and record whatever the verifier reports for an
unsupported toolchain, which is an unmeasured result and not a pass. `swarm-orchestrator-rules`
has no primary language and is inspected for a check before it is called inapplicable.
`moonrunnerkc/moonrunnerkc` is a profile README with no code and is inapplicable.

## Recorded as inapplicable

| Repository | Reason |
| --- | --- |
| awesome-ai-coding-tools, awesome-llm-skills, skillcreatorai-awesome-agent-skills, awesome-agent-skills, tool-center, is-number, awesome-code-review-tools, awesome-ai-code-review, awesome-software-supply-chain-security, Awesome-AI-Agents, awesome-ai-devtools, awesome-copilot, chatwoot | forks |
| moonrunnerkc/moonrunnerkc | profile README, no code |
| ruleprobe-api-service, ruleprobe-semantic, code-style-enforcer, aftermathtech, recursive-ideology-systems, snre, neuro-symbolic-swarm, aasms | archived |
| rupture, swarm-eg-fixture-py, swarm-eg-fixture-go, mcia, premise, callspec, SwarmSeal, waveinfer-pro, resonancemind, freelance-guardian, test-repo, aioutputcontrol-site, managedwebsiteops, mwo-portal-backend, aegis-k8s, swarm_trainer, EBSNet-IP, belief-ecology, gda-premium-core, gravitational-data-attractor, ContradictTraceAI-Showcase, Aftermath-ContradictTraceAI, sentinel-os-landing, chronocodex, blackbox-mind-v3, neutronvault, promptforge-site, PromptForge, whats-in-my-fridge, killgrid-ai, ai-viralhook-generator, commandthread, dossier, abes, sentinel-os-core, svpiw, symparse, .github, lunar-delayforge-ai, shadow-ecology | private, not open source; not the Aftermath site |

## Rollout state

Sixteen pull requests were opened on 2026-09-27 by `scripts/rollout-action.mjs`, each adding
the workflow pinned to the distribution commit of a prerelease; each run signed its verdict as
a GitHub attestation and posted one comment bound to the head. What the candidate `1.0.0-rc.6`
(distribution `635e14a2a`) measured, and what it exposed:

| Pull request | rc.6 verdict | What it exposed |
| --- | --- | --- |
| [quantproof#1](https://github.com/moonrunnerkc/quantproof/pull/1) | not verified, inherited: 30 tests fail at base and head | `better-sqlite3` needs its install script; the policy installs with scripts off, and the comment names exactly that. Honest red, a repository property |
| [crossfire#1](https://github.com/moonrunnerkc/crossfire/pull/1) | regression-only pass | nothing |
| [claimcheck#1](https://github.com/moonrunnerkc/claimcheck/pull/1), [pubprep#1](https://github.com/moonrunnerkc/pubprep/pull/1), [dumpscan#1](https://github.com/moonrunnerkc/dumpscan/pull/1), [counterfactual-court#1](https://github.com/moonrunnerkc/counterfactual-court/pull/1) | incomplete: tests "malformed runner output" | the suites log to stdout, or the test script prints its own verdicts, into the JSON reporter's stream. Fixed: the runner reports to a file and prints only that file |
| [ruleprobe#3](https://github.com/moonrunnerkc/ruleprobe/pull/3) | not verified: two CLI tests fail on the head and pass at the base | a nondeterministic suite (`tests/cli/semantic-flags.test.ts` expects CLI output that arrived empty), which a base control cannot tell apart from a regression; the advice now says so. Not fixed in the verifier: it reports what it observed |
| [cronproof#2](https://github.com/moonrunnerkc/cronproof/pull/2) | incomplete: every check "not installed" | `pnpm run` in an image that carries no pnpm (the lockfile installs through a fetched pnpm, the checks did not). Fixed: scripts run through npm. dumpscan's typecheck, lint and build failed the same way |
| [depose#4](https://github.com/Aftermath-Technologies-Ltd/depose/pull/4) | not verified, inherited | the same two defects as cronproof and claimcheck: `pnpm run` in an image without pnpm, and a suite whose stdout is not the report alone |
| [tracemantle#16](https://github.com/moonrunnerkc/tracemantle/pull/16), [rlfusion-orchestrator#2](https://github.com/moonrunnerkc/rlfusion-orchestrator/pull/2), [nborder#2](https://github.com/moonrunnerkc/nborder/pull/2), [ironroot#1](https://github.com/Aftermath-Technologies-Ltd/ironroot/pull/1) | incomplete: isolation unknown | the uv image carries no node, and the containment probes were node scripts. Fixed: probes are shell scripts with node, python3 and bash fallbacks for the network attempt. These repositories also carry no `uv.lock`, which the verifier will name next |
| [gemma-witness#50](https://github.com/moonrunnerkc/gemma-witness/pull/50), [nondet#1](https://github.com/moonrunnerkc/nondet/pull/1), [swarm-orchestrator-rules#1](https://github.com/moonrunnerkc/swarm-orchestrator-rules/pull/1) | incomplete: every check stood down | Rust, Java and no toolchain: unsupported, recorded as unmeasured and not as a pass. The advice wrongly suggested missing dependencies; it now names the check that measured nothing |

The pull requests are re-pinned to each later candidate by `scripts/rollout-repin.mjs`; the
rows above are replaced by the stable release's results when it ships. A person merges.
