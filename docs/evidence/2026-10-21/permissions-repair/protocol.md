# Development trial on minimatch under the corrected permissions: protocol, registered before any inference

Registered after the corrections to the 2026-10-20 comparison were appended
([../../2026-10-20/ordinary-comparison/README.md](../../2026-10-20/ordinary-comparison/README.md),
"Corrections"), after the allowed-change policy was built and tested
(`scripts/comparison/change-policy.mjs`), after the reader defect that refused the launch's
diagnostics was fixed and replayed (`src/tools/inline-program-denials.test.ts`), and after the
task was revalidated under the policy with the base's checks executed
([validation.json](validation.json)) and read four ways ([reference-feasibility.json](reference-feasibility.json)).
No model was involved in any of that. Every launch goes in [launches.md](launches.md), entered
before it starts, failed starts included. This file is not edited after the first launch; a
change of plan is an amendment appended below the line at the end, dated, before the launch it
affects.

## The question

Whether ordinary Swarm, given the task and the public checks with the permissions the task
actually needs, delivers a complete source-and-test change on
`minimatch-bugfix-partial-globstar`. Minimatch is exposed development material: it was launched
on 2026-10-11 and 2026-10-20 and its upstream change and records are in this repository. A
success here is a development result about one obstruction removed; it is not evidence of
general superiority and is not a comparison.

## Task

`minimatch-bugfix-partial-globstar` (isaacs/minimatch), the task text and visible check of
`scripts/comparison/tasks.mjs` at the registering commit, base `ea94840326c3`, upstream
`3a0d83b6f03a`. Swarm starts from the original base with the visible check committed and is
given the task text, the visible check and the test command. It is given nothing of the upstream
patch, the hidden test, the previous launches' patches or any reviewer-written fix.

## What changed since 2026-10-20, and nothing else

| what | 2026-10-20 | now |
| --- | --- | --- |
| permissions | contract froze `acceptance/visible` and the whole `test/` directory | the shared allowed-change policy: the visible check's directory and the runner configuration files are protected; implementation code and regression tests are allowed; existing assertions, skip markers, coverage exclusions and the test scripts are held at evaluation (`change-policy.mjs`, the same words in the task text) |
| reader | a `node -e` probe was refused on paths in its comments (records 405, 423, 441, 527) | comments and string literals are read as what they are (`src/tools/shell-command.ts`) |
| build | `8ce795eb8` | `96b20a89c`, the two commits above and nothing else in `src`, `scripts`, `packages` or the package files |
| everything else | | unchanged: model, server, limits, product defaults, runner, order of operations |

No planning rule was added, no repair cap raised, no controller change made.

## Configuration

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192, as the runner configures it; one model resident, one request at a time, nothing heavy beside the launch |
| Swarm | commit `96b20a89c`, cloned into `~/.cache/swarm-comparison/tools/swarm-96b20a89c`, built there with `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:2bb07c9a9bf4...` (the entry file, unchanged by the modules it loads), the whole `dist/` tree of 862 files `sha256:d2c614e8495e...` (the sorted per-file SHA-256 list, hashed). Ordinary configuration: no workflow flag, legacy prompt, no planned checks, the experimental repair handoff off |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` at the registering commit, its harness digest in the manifest |
| checkouts | `~/swarm-comparison-work`, a fresh shallow clone of the base per launch |

## Limits

| limit | value |
| --- | --- |
| launches | at most two development launches, of at most 10 minutes each (9 minutes and half a second of arm wall, the kill confirmed inside 59.5 s). The second is allowed only after a concrete correction named in an amendment, never as a retry of the same configuration |
| readiness | the runner's own, at most 2 sequences of at most 90 s before dispatch, recorded apart |
| tokens | the common safety bound of 8,000,000 per launch |
| corrections | none; no person interacts with the tool |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call. Nothing is raised to obtain a pass |
| spend | no paid API, no model download, no configuration tuning, no server restart |
| this work's whole allowance | two development launches and six comparison launches, at most 90 agent-minutes of inference and failed starts in all, counted in [launches.md](launches.md) |

## Evaluation, frozen, on the exact delivered tree

1. **The unchanged project test command** on the delivered tree: `npm test`, which is tap with its
   100% coverage rule. The runner's visible verdict records it.
2. **The visible check** (the runner's visible verdict).
3. **The hidden oracle**: the runner's `hiddenVerdict`: the allowed-change policy by name, then the
   upstream `test/partial.ts` overlaid on a fresh checkout with the exact patch, its argv, and the
   project's tests. A file the patch wrote at that path is displaced and named.
4. **The bounded regression audit**: the frozen probe of 2026-10-20
   ([../../2026-10-20/ordinary-comparison/evaluation-probe.mjs](../../2026-10-20/ordinary-comparison/evaluation-probe.mjs))
   on the exact patch against its reference
   ([../../2026-10-20/ordinary-comparison/probe/upstream.json](../../2026-10-20/ordinary-comparison/probe/upstream.json)):
   six requested, four negative and nine preserved rows scored; its two observed rows reported.
5. **The regression test**: the policy's count of assertions added in test files, which must be at
   least one for a "complete source-and-test change".
6. **Product status**: Swarm's own report, final verification and exit code.
7. **First implementation and delivered tree, apart**: the tree at the first gate cycle, read from
   the run's ledger (the first `gate-run` cycle's workspace and the ratchet's attempt 0), and the
   final `workspace-diff`. Repair is judged by whether the first tree failed the evaluation above
   and the delivered tree passes (repair improved correctness), both pass or both fail the same
   way (repair preserved it), or the first passed and the delivered does not (repair damaged it).
8. **Time and tokens**: the arm's own wall from spawn to exit or kill; preparation, readiness,
   scoring and cleanup apart; every prompt and completion token as the server counted them, with
   any call that reported no usage named.

**Decision rule, fixed now.** Swarm "delivered a complete source-and-test change" only if its
exact tree passes 1, 2 and 3, matches the reference on every scored probe row of 4, adds at least
one assertion under 5, and the arm exited 0 inside the deadline with its own verdict acceptable.
Anything less is reported as not delivered, with the earliest actionable failure named from the
trace.

## If it fails

The earliest actionable failure is read from the run's ledger and named. A second development
launch follows only a concrete correction, recorded as an amendment here before it, with the
commit that makes it. A second launch of the same configuration is not a correction and is not
made.

## Reported

The evaluation above, item by item; the first implementation and the delivered tree; the repair
reading; time and tokens; the limits of one launch on exposed material.

---

## Amendments
