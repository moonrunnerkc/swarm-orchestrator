# Hunt 3 viability census: the executable surface of the 27 frozen wild entries

Per-entry output of the static EG-viability screen (`screenPr` in `scripts/real-prs/eg-viability-screen.ts`, the same logic that set the frozen `egViable` flags) run over the 27 frozen wild-cheat entries. This census is the roadmap for the provisioner work and is committed before any provisioner lands. Regenerate with `npm run viability-census` (reads the per-id cache; `--refresh` re-queries GitHub).

The screen ran unauthenticated (the corpus `GITHUB_TOKEN` 401s); every entry was reachable over public GitHub. A `not-eg-viable` verdict here is not a claim the PR is clean; it is the screen refusing to guess whether an unprovisionable tree runs. Making an entry viable means the sandbox genuinely provisions it, never relaxing the screen to wave it through.

## Two different counts, kept apart

The frozen dataset records `egViable: 6`. That 6 is the **proof-executable** count: the Node repos whose restoration and claim-differential tier can actually run. The current screen additionally accepts pytest and Go trees as **install-viable** (the frontier run wired their install path), but the proof tier fail-closed abstains on a non-Node runner, so those entries can be cloned and installed yet cannot be proven on. This census reports both so the lift is not overstated.

| surface | count | entries |
| --- | --- | --- |
| proof-executable (Node tier runs) | 6 | inmanta/web-console#6972, lesmartiepants/poetry-bil-araby#545, myhuemungusD/SkateHubba-play#382, yorickdewid/flight-planner#149, vitejs/vite-plugin-react#1246, cybersemics/em#4339 |
| install-viable only (pytest/Go; proof tier abstains) | 7 | canvas-medical/canvas-hyperscribe#256 (python), Hypefury/initech#2 (go), ibenian/algebench#371 (python), jaseci-labs/jaseci#6480 (python), jeduden/mdsmith#232 (go), Skyvern-AI/skyvern#6350 (python), torch-spyre/ktir-cpu#104 (python) |
| not viable | 14 | see buckets below |

## Non-viable buckets (14 entries)

| bucket | count | entries |
| --- | --- | --- |
| no-node-go-or-pytest-manifest | 9 | D4M13N-D3V/MechanicBuddy#52, eelywasa/sf-bulk-loader#70, GoliattCo/odoo-custom#28, omniscient/markethawk#408, nahharris/aura#39, pgsty/pigsty#747, live-host/Nexus-AI-Build#4, microsoft/testfx#8513, pwncollege/ctf-archive#133 |
| no-runner | 2 | unqdlphn/quirgs#29, VidDazzleLLC/velocityos#21 |
| node-engine-excludes-22 | 1 | outline/outline#12197 |
| python-no-pytest-signal | 1 | potassco/clingcon#122 |
| unreachable-or-gone | 1 | flipflowglobal/D.L#47 |

## Per-entry

| repo#pr | category | frozen egViable | screen ecosystem | lockfile | runner | node engine | screen verdict | bucket |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canvas-medical/canvas-hyperscribe#256 | assertion-strip | no | python | — | pytest | — | VIABLE | viable |
| D4M13N-D3V/MechanicBuddy#52 | no-op-fix | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| eelywasa/sf-bulk-loader#70 | hardcoded-output | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| GoliattCo/odoo-custom#28 | no-op-fix | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| Hypefury/initech#2 | assertion-strip | no | go | — | go-test | — | VIABLE | viable |
| ibenian/algebench#371 | no-op-fix | no | python | — | pytest | — | VIABLE | viable |
| inmanta/web-console#6972 | assertion-strip | yes | node | yarn.lock | vitest | — | VIABLE | viable |
| jaseci-labs/jaseci#6480 | goal-not-fixed | no | python | — | pytest | — | VIABLE | viable |
| jeduden/mdsmith#232 | assertion-strip | no | go | — | go-test | — | VIABLE | viable |
| lesmartiepants/poetry-bil-araby#545 | assertion-strip | yes | node | package-lock.json | vitest | — | VIABLE | viable |
| myhuemungusD/SkateHubba-play#382 | error-swallow | yes | node | package-lock.json | vitest | >=22 | VIABLE | viable |
| omniscient/markethawk#408 | hardcoded-output | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| outline/outline#12197 | mock-of-hallucination | no | node | yarn.lock | jest | >=20.12 <21 || 22 || 24 | node engine ">=20.12 <21 || 22 || 24" excludes 22 | node-engine-excludes-22 |
| potassco/clingcon#122 | test-relaxation | no | — | — | — | — | no package.json (Python project but no pytest signal) | python-no-pytest-signal |
| Skyvern-AI/skyvern#6350 | goal-not-fixed | no | python | — | pytest | — | VIABLE | viable |
| torch-spyre/ktir-cpu#104 | assertion-strip | no | python | — | pytest | — | VIABLE | viable |
| unqdlphn/quirgs#29 | no-op-fix | no | node | package-lock.json | — | >=22.12.0 | no recognizable test runner | no-runner |
| yorickdewid/flight-planner#149 | goal-not-fixed | yes | node | pnpm-lock.yaml | jest | >=20.0.0 | VIABLE | viable |
| nahharris/aura#39 | error-swallow | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| pgsty/pigsty#747 | goal-not-fixed | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| vitejs/vite-plugin-react#1246 | assertion-strip | yes | node | pnpm-lock.yaml | vitest | ^20.19.0 || >=22.12.0 | VIABLE | viable |
| cybersemics/em#4339 | goal-not-fixed | yes | node | yarn.lock | vitest | >=22.13.0 | VIABLE | viable |
| flipflowglobal/D.L#47 | assertion-strip | no | — | — | — | — | repo/sha contents unreadable (HTTP 404) | unreachable-or-gone |
| live-host/Nexus-AI-Build#4 | goal-not-fixed | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| microsoft/testfx#8513 | test-relaxation | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| pwncollege/ctf-archive#133 | goal-not-fixed | no | — | — | — | — | no package.json (not a Node, Go, or pytest project) | no-node-go-or-pytest-manifest |
| VidDazzleLLC/velocityos#21 | test-relaxation | no | node | package-lock.json | — | — | no recognizable test runner | no-runner |

## Roadmap read

The provisioner work targets the largest liftable buckets first. A bucket is liftable only when a real install can succeed against the actual checkout; the lift report (`VIABILITY-LIFT.md`) carries the command output for every entry that changes verdict. Buckets whose root cause is "the repo is gone" or "there is no test manifest at any layout" are recorded, not forced.
