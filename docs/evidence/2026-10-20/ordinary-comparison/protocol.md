# One fresh ordinary comparison, Swarm against OpenCode: protocol, registered before any inference

Registered after the correction of the repeated-call tracker was verified on its reproduction
([../repeat-key/](../repeat-key/README.md)) and after the task was selected by the rule in
[selection.md](selection.md), with no model involved in either. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts, failed starts included. This file is not
edited after the first launch; a change of plan is an amendment appended below the line at the
end, dated, before the launch it affects.

## The question

Whether ordinary Swarm completes a new task at a useful cost compared with OpenCode, on one task.
One pair cannot establish general superiority. If neither arm shows an advantage under the rule
below, that is reported plainly and nothing further is launched: no planning rule is added and
nothing is rerun.

## Task

`minimatch-bugfix-partial-globstar` (isaacs/minimatch), the task text and visible check of
`scripts/comparison/tasks.mjs`, its base and upstream commits as [validation.json](validation.json)
resolves them, validated there and in [probe/](probe/); the first entry the selection rule
reached, `js-yaml-bugfix-timestamp-early-years`, is recorded in [selection.md](selection.md) as
not runnable by the runner's preparation and was never launched. Both arms start from the original base
with the visible check committed; no seeded candidate, scripted implementation, replayed repair,
upstream solution or investigator hint reaches either.

## Configuration, the same for both arms

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b` (digest `096fdbd02fe6`), thinking off, `max_tokens` 8192, as the runner configures both arms; one model resident, one request at a time, nothing heavy beside a launch |
| Swarm | the fix commit `8ce795eb8`, cloned into `~/.cache/swarm-comparison/tools/swarm-8ce795eb8`, built there with `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:2bb07c9a9bf4...` (an entry file whose bytes do not change with the modules it loads), the whole `dist/` tree of 862 files `sha256:138b638e0300...` (the sorted per-file SHA-256 list, hashed). Its ordinary configuration: no workflow flag, legacy prompt, no planned checks, the experimental repair handoff off (`recentShellResults` is not passed by the worker). The commits after `8ce795eb8` on the branch change only documentation and evidence (`git diff 8ce795eb8..HEAD --stat -- src scripts packages package.json package-lock.json` is empty at registration) |
| OpenCode | 1.14.48, configured by the runner as in every earlier launch: edit and shell allowed in the workspace, no web fetch, HOME the launch's own directory |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` unchanged, its harness digest in the manifest; the endpoint watch, the readiness sequence before each dispatch, the stall watch on Swarm's stream and the halt records as they stand |
| checkouts | `~/swarm-comparison-work`, a fresh shallow clone of the base per launch |

## Limits, the same for both arms

| limit | value |
| --- | --- |
| task launch | the deadline is set after preparation at 9 minutes and half a second of arm wall; the arm's process group is killed at it, with 59.5 s to confirm the kill, so a launch ends inside 10 minutes. Swarm is handed `--max-wall-minutes 9` and holds its final-verification reserve inside it; OpenCode is handed the same deadline |
| aggregate task time | two launches, at most 18 minutes and 1 second of arm wall in all, inside the 20-minute bound |
| readiness, bounded apart | the runner's own: before each dispatch at most 2 sequences of at most 90 s, each at most 3 requests of at most 30 s and 64 output tokens, in the product's wire shape; its timing and usage are recorded apart from the task's. A launch is not dispatched on a listing alone |
| tokens | one common safety bound of 8,000,000 per launch, all internal work charged; Swarm enforces it natively, OpenCode's total is recorded |
| corrections | none; no person interacts with either tool |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call. Nothing is raised to obtain a pass |
| spend | no paid API, no model download, no configuration tuning, no server restart unless approved |

## Order, registered now

1. **Swarm**, ordinary configuration ([manifest.json](manifest.json), order 0).
2. **OpenCode** ([manifest.json](manifest.json), order 1).

Sequential, nothing else running. Both run whatever the first gives. Every attempted launch is
recorded in [launches.md](launches.md). A launch that fails for an infrastructure reason (the
endpoint died, the runner halted on its own failure, a workspace could not be prepared) is
recorded as such and not replaced; an unfavourable result is not replaced.

## Before launching

- The independent evaluation is validated against the base and the reference fix
  ([selection.md](selection.md), [probe/](probe/)) and frozen with this file.
- The selection decision is frozen with this file.
- Both tools are shown able to start without spending a task launch: the runner's dry run of the
  manifest, the product's gate-plan preflight on the base called directly with no model (the step
  that halted the fxp task on 2026-10-19), and `opencode --version`. These are recorded in
  [launches.md](launches.md) under "before the first launch".

## Evaluation, frozen, on each exact delivered tree independently

1. **The hidden oracle**: the runner's `hiddenVerdict` on a fresh checkout with the exact patch
   (the upstream test file, the project's tests, the closed file set).
2. **The frozen probe** ([evaluation-probe.mjs](evaluation-probe.mjs)) on a fresh build of the base
   with the exact patch, matched row by row against [probe/upstream.json](probe/upstream.json):
   six requested rows, four negative rows, nine preserved rows; its two `observed` rows (dot
   files under partial matching with `**`, which the task does not state) are reported, not scored.
3. **The project's tests** and **the visible check**, the runner's visible verdict.
4. **Product status**: Swarm's own report, final verification and exit code; OpenCode's exit code
   and whether it claimed success.
5. **Any additional observed defect** in the delivered tree, named apart.
6. **Time**: the arm's own wall from spawn to exit or kill; preparation, readiness, scoring and
   cleanup apart. **Live tokens**: every prompt and completion token as the server counted them,
   with any call that reported no usage named.

**Decision rule, fixed now.** An arm "delivered a correct change" only if its exact tree passes
the hidden oracle, matches the reference on every requested, negative and preserved probe row, passes the project's tests and the
visible check, and the arm exited 0 inside the deadline claiming completion (for Swarm, with its
own verdict acceptable). Swarm "showed an advantage" only if it delivered a correct change and
OpenCode did not. If both delivered or neither did, there is no demonstrated advantage; cost is
then reported, and a cost difference is not an advantage in correctness. If OpenCode delivered
and Swarm did not, that is reported as Swarm's loss.

## Reported

Per arm: the frozen-check results (oracle, each probe row, project tests, visible check), any
additional defect, the product's status, time and live tokens, each apart; then the decision
above, the costs, the limits of one pair, and the exact commits.

---

## Amendments
