# Controlled comparison campaign: development records, 2026-09-29

Development evidence for the campaign registered in
[campaign-protocol-2026-09-29.md](../../../verifier-first/campaign-protocol-2026-09-29.md). Nothing
here was run on a final-set goal by any verifier or workflow arm; final-set goals were touched only
by the deterministic validation below, which runs no arm and no model.

- [repair-investigation.md](repair-investigation.md): the four unsuccessful Comparison B repairs of
  2026-09-28, their mechanism defects, and what changed.
- [validation.json](validation.json): deterministic validation of every final and development goal
  in its prepared image (hidden oracle, visible checks, project test, for the base, the reference
  and every condition).
- [goals/](goals/): the goal packages (task text, visible contract, reference, conditions), packed
  losslessly; `node scripts/local-campaign/archive.mjs docs/evidence/2026-09-29/campaign/goals`
  restores them. The hidden oracles are not here; they stay sealed until final scoring.
- [competitors/](competitors/): the Ranex x86-64 VM eligibility run and the Critique local-route
  run, as summarized in the protocol's capability matrix.
- [manifest-prefreeze.json](manifest-prefreeze.json): the 882 launches, built with the development
  pin; the freeze rebuilds it with the owner's pin.
- [development-pilot.json](development-pilot.json): every development pilot launch, by round, with
  its decision, wall time, agent time, tokens, truth and oracle-exposure scan. Full launch records
  (argv, exit status, output by digest) are under `~/.cache/swarm-campaign/runs/`.

## What the development pilot found, and what changed because of it

Each round ran under its own manifest (a fixed launch never reruns); what a round exposed was fixed
in the campaign scripts before the next.

1. **Agent under a network-disabled container could not upgrade anything.** With the agent's
   commands behind `--isolation docker`, no arm could regenerate a lockfile, so every upgrade goal
   was unsolvable for every arm alike. The agent now runs as the product runs by default, restricted
   on the host, installed by the goal's own argv (rounds 1 to 3).
2. **Worker flags.** The preset path's final verification needs `--install` for a fresh checkout,
   and an unattended run needs `--approve auto`; without them every launch stopped before a model
   call (round 0).
3. **Leftover workspaces** from an interrupted attempt made the next clone fail and read as the arm
   being inconclusive; attempts now get fresh directories and a harness exception is an
   infrastructure failure, rerun under the registered rule (round 0b).
4. **swarm-verify's own Python install** syncs only default dependency groups; the arms stage the
   environment the goal's install prepared, the verifier's documented alternative (round 2).
5. **Plain CI judged the agent's own workspace** (host-built dependencies); it now judges the change
   in a fresh checkout in the goal image (round 3).
6. **VERA flags and files.** `vera record` parsed the agent's flags as its own (now after `--`);
   VERA's database is ignored by git and kept out of the change; the recorded agent keeps its own
   HOME (rounds 2 to 5).
7. **VERA's integrity check fails after every recorded worker run** (5 of 5 launches: "EVIDENCE
   INTEGRITY VERIFICATION FAILED: Hash mismatch for runs ID ..."), so the VERA workflow arm read
   inconclusive in every development launch, twice with final trees the hidden oracle passes. The
   same release verifies after recording simple commands, the exact recorded argv with `echo` in
   place of `node`, and the recorded agent's full output replayed (seven probes). A `git clean -x`
   during a recorded run reproduces an integrity failure in isolation, and VERA's database path is
   fixed to the working directory (`cmd/vera/main.go`, `filepath.Join(".", "vera-evidence.db")`);
   the agent's own sessions show it inspecting `vera-evidence.db`. The cause is not established.
   This is the main open issue for the b5 arm.
8. **Upgrade policy errors.** The pinned product raises an upgrade authorization failure ("must
   target exactly", "upgrade change outside declared scope") as an error before writing any
   report, on `ci` and on the task path; the arms read that printed refusal as a refusal (round 6).
9. **VERA installed before the change was recorded**, so an upgrade was verified against the old
   lockfile's install; it now installs over the tree it verifies (round 6).
10. **Immutable-path refusals.** swarm-verify refuses a patch that reaches a declared-immutable
    path before running anything; that is read as a refusal, not as unmeasured (round 5).
11. **The development Python goal (markupsafe)** needs a C build that the verifier's Python image
    cannot perform without a managed interpreter, and a managed interpreter outside the mounted
    checkout is not visible to the verifier's containers, so every swarm-verify decision on it is
    inconclusive. The final Python goals install from wheels and do not share this; the staging
    path for Python was therefore not exercised by a successful development launch, which is a
    residual risk for the final run.
12. **Model behaviour.** On the upgrade development goal the model looped on one inspection command
    for dozens of steps and never changed the manifest in several arms; the worker did not stop
    the repetition.

## Product findings for the verifier fixes in flight

- **A goal contract without a preset is refused on the worker path** (`--challenges needs a
  --preset run with a --goal-contract to challenge`; `--goal-contract` is read only with
  `--preset`). Feature goals have no preset, so b2, b3 and b4 are unsupported on the six feature
  goals: 54 of the 360 requested Comparison B launches. A `feature` preset, or accepting a goal
  contract without one, would make the requested 360 possible; the manifest is regenerated before
  freeze if the pinned revision allows it.
- **Upgrade authorization failures are raised as errors, not verdicts**, on `ci --json` (no JSON
  report is written) and on the task path (no `swarm.result.v1` line), so a caller cannot tell a
  policy refusal from a crash without reading stderr.
- **The worker does not stop an identical tool call repeated dozens of times** (development
  upgrade goal, one inspection command repeated in consecutive steps).
- **swarm-verify's own uv install syncs only default dependency groups**; projects that keep pytest
  in a named group read as unmeasured unless a prepared `.venv` is staged.
- **The base-measurement defect found in the Comparison B repairs** was fixed on v13-main in
  4fd2ce5fd; the false-green direction is pinned by the test this work adds.

## Resource statement

Nothing here spends money beyond this machine's electricity: every model is local (rapid-mlx
serving `qwen3.8:27b` at `http://127.0.0.1:8000/v1`), every tool is installed locally, and no code
leaves the machine except dependency downloads from the public npm and PyPI registries during
installs, which fetch published packages and send no repository code.

**Launches in the manifest** (final set, generated by `scripts/campaign/manifest.mjs` from the 24
final goals): **882**, of which **576** are Comparison A (144 conditions times four deterministic
arms: plain CI, VERA, swarm-verify S0, swarm-verify S1) and **306** are Comparison B (18 goals times
five arms times three repetitions, plus six feature goals times the two arms that support them
times three). **20** arm-goal cells are unsupported and never launched: b2, b3 and b4 on the six
feature goals (54 launches' worth), the Ranex arm (eligible inside the emulated x86-64 VM, its
campaign runner not yet built; it would add 144 launches, all inside the VM, at about 6 seconds of
Ranex time each plus the goal's own install and tests under full-system emulation, which were not
measured on a final-size goal) and the Critique arm (not eligible: its local route fails as
shipped).

**Measured time per launch** (development pilot, same machine, development goals, which are
smaller than the final ones): Comparison B in host mode, 10 launches, median 622 s, mean 752 s,
longest 2,178 s (upgrade goal, VERA arm); by arm on the cookie goal, plain CI 119 s, baseline
156 s, challenges 162 s, challenge-and-repair 354 s, VERA 802 to 1,151 s. Comparison A, 72
launches, median 2 s and longest 82 s on those small goals. Deterministic validation of one final
goal (eight trees, each installed and run three ways in its image) took 10 to 15 minutes, about
1.5 minutes per tree, which is the best available estimate of a final-goal CI or VERA decision;
a swarm-verify decision runs the checks twice (candidate and base) and, under S1, the challenges.

**Estimated wall time at one job at a time.** Comparison A: plain CI and VERA about 1.5 minutes,
S0 about 5, S1 about 10, so about 18 minutes per condition across the four arms, **about 43 hours**
for 576 launches. Comparison B: final goals are larger than the development ones, so the estimate
doubles the pilot mean to about 25 minutes plus about 2 minutes of truth scoring, **about 138
hours** for 306 launches, with a hard ceiling of 306 times (45 + 5) minutes = 255 hours. Total
**about 180 hours (about 7.5 days)** of machine time, ceiling about 300 hours. Tokens: the pilot
spent about 0.1 to 1.5 million tokens per B launch; 306 launches at the 1.5 million cap is at most
**459 million local tokens**.

**Pace limits** that bound this: at most one model resident; no x86-64 VM beside a model-driven
launch or a Docker-heavy job; colima capped at 8 GB and 4 CPUs; no full test suite of this
repository while a model generates; no job over 4 GB with under 25% free memory, and validation
yields below 30% free. During this session memory fell under 30% several times while an onboarding
VM and the model ran, and the validation pass paused itself each time.

**Cost.** Electricity only. At an estimated 120 to 200 W under sustained load for about 180 hours,
about 22 to 36 kWh; no model or cloud charge.

**Proposed hard cap**: 300 hours of machine time and 460 million local tokens for the final set,
with each launch capped at 45 minutes (B) or 30 minutes (A) plus truth scoring; a launch that hits
its cap records its decision as the arm left it. A smaller campaign is not the registered one and
is reported as partial.

**Data exposure**: the 24 final goals' base commits, reference patches and conditions are public
repositories' code and this campaign's own patches; the hidden oracles stay sealed under
`~/.cache/swarm-campaign/sealed/` until scoring is complete. Nothing is sent to a hosted model or
service.
