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

Nothing has been rolled out yet. Rows move to `green`, `red control exercised` or a named
blocker with links to the executed workflow run and the signed verdict as the Action ships.
