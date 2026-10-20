# One matched development pair at the repair boundary: control and treatment, protocol

Registered before any live inference under this work, after the deterministic rehearsals of both
arms with no model ([rehearsal-control/](rehearsal-control/record.json),
[rehearsal-treatment/](rehearsal-treatment/record.json)) and after the gates on the two builds.
The two launches and every readiness sequence go in [launches.md](launches.md), entered before they
start. This file is not edited after the first probe; a change of plan is an amendment appended
below the line at the end, dated, before what it affects. The closed protocol of
[../../2026-10-19/endpoint-readiness-trial/protocol.md](../../2026-10-19/endpoint-readiness-trial/protocol.md)
and its result stand unchanged; nothing of its allowance is reused.

## Hypothesis

A fresh repair attempt may use evidence better when its brief retains a small number of actual
diagnostic results from the previous attempt. The account of the previous loop kept the shell
commands that printed nothing or exited non-zero; in run `20261020T045117-41e2cc` that dropped
R 477, R 483 and the step-40 result (`[fF][pP]` tested against `ftp`, null each time). The
treatment's account carries the last three nonempty successful shell results of the previous
attempt ([account-attempt-1-treatment.txt](account-attempt-1-treatment.txt)); the control's is the
account the second attempt was actually handed ([account-attempt-1-control.txt](account-attempt-1-control.txt)).

## What this can show

Whether, on this one exposed task, a live second attempt given that account turns the retained
incorrect candidate (the scheme class spelled `[fF][pP][tT]`, [../../2026-10-19/endpoint-readiness-trial/launch-1/final.patch](../../2026-10-19/endpoint-readiness-trial/launch-1/final.patch))
into a correct delivered patch, and at what cost, against a control attempt given the account
without those results. One pair is a development observation. It does not establish a reliable
improvement, anything about another coding agent, or anything about other tasks. The task, its
records and the upstream change are known to the people developing Swarm.

## The two arms

| | control | treatment |
| --- | --- | --- |
| build (product commit) | `c538331f0` | `afa2deedc` |
| `dist/` tree (862 files) | `sha256:7553d0439534e4499ef218cac852102aedd17f593dcc4785fe1b8d5e5293d5a9` | `sha256:1ea18c82c7549f8187e00ce63077b3dc5390320da669be738bf1ab1f82d341d5` |
| `dist/core/loop-account.js` | `sha256:f952ff6800ce6881f49779eaee8513e9bfb6d87cd550d0121d890efb66bcd2bd` | `sha256:7b2ee45c6e35a223139c582d6bcf172d04210f57f077a8b067a503f65f2231c4` |
| `dist/cli.js` | `sha256:2bb07c9a9bf46cda45759455c27f21d8336fe0d3dc6d20e4e5461bfc026ea6e0` (the entry file is the same bytes in both and in the trial's build; it identifies no build) | the same |
| account builder | keeps commands that printed nothing or failed (the trial's) | the same, plus the last three nonempty successful shell results |
| everything else | identical | identical |

Both builds carry the tool-feedback corrections of `c538331f0` (the shell tool named as a possible
writer; the repeat notices kept to what the tracker knows). The treatment commit changes
`src/core/loop-account.ts` and its test, and the changelog, and nothing else of the product.

**Order, declared now:** control first, then treatment, sequentially; nothing runs beside either.

## Launch mechanics: the repair boundary

[repair-boundary.mjs](repair-boundary.mjs), the same script for both arms, differing only in
`--arm` and `--build`. Each launch:

1. clones the task's frozen base (`e3c0d3e`), commits the visible check (`f12c61d`) and installs,
   as every launch of the comparison does;
2. gives the product the run's recorded sealed goal contract (R 3 of the run chain: the visible
   check and the planner's two admitted generated checks), so the gates and their identities are
   the trial's (`task-acceptance`, `task-diagnostics` of sealed goal `sha256:904f8aae...`); no
   planning runs and `--plan-checks` is not passed;
3. points the product at a proxy. Its first three chat completions are answered by the repository's
   scripted endpoint: a worker that declares `src/rules.ts`, writes the candidate's exact bytes
   (`sha256:c695f84b...`, the retained workspace's) and finishes. Its next forty are the first
   repair attempt's forty recorded responses (R 222 to R 485), in order, each tool call run for
   real through the chokepoint, so the attempt's conversation is the product's own and the account
   the second attempt is handed is derived by the production builder from it. Every chat completion
   after the forty-third goes to the local model server;
4. runs the product's ordinary command line with the comparison's Swarm arguments (`--approve auto`,
   `--install`, the project's test command as the blocking `tests` gate, no workflow flags), a
   model wall of **7 minutes** (`--max-wall-minutes 7`) and the 8,000,000-token safety bound;
5. kills the launch at **10 minutes** if the product has not exited;
6. scores the delivered tree apart (below).

The planning and implementation of the original run are not replayed; the candidate is placed by a
three-step scripted worker. The rehearsals show the handoff: the forty-third scripted turn is
played and the forty-fourth request's last user message is the second attempt's brief, whose
account in the control rehearsal equals R 513's byte for byte, and in the treatment rehearsal
carries the three results.

## Repair time, and why it differs from the original

The original second attempt had 44,464 ms, the arithmetic of a shared 840 s wall after planning,
implementation, a 147 s first attempt and two gate cycles. Here the first attempt's answers are
scripted, so its model time is not spent (the rehearsal's replay took about 70 s of tool time), and
the wall is 7 minutes: after the scripted first loop, the first gate cycle, the replay and the
second gate cycle (about 105 s after the session starts in the rehearsals) and the reserve for the
next cycle (about 33 s), the second attempt has roughly 280 s. Both arms have the same allowance.
The question is whether the account changes what an attempt does with an allowance long enough to
edit and verify; the original's 44 s could not show that either way. The product's step cap (40),
attempt cap (3), ratchet, rollback and reserve rules are unchanged; a third attempt runs only if
its allowance stays above the product's floor.

## Allowance

- **Exactly two task launches**, one per arm, each at most 10 minutes end to end (the kill above);
  **20 minutes** of aggregate task time. No replacement launch for any failure, valid or
  infrastructure.
- **Readiness**, per launch: at most two sequences of at most three inference requests through the
  comparison runner's own readiness, each request 30 s and each sequence 90 s; its usage recorded
  apart from the task's. A launch whose readiness fails is not dispatched, recorded as an
  infrastructure result, and is still one of the two launches. **Readiness is bounded to 2 × 90 s
  per launch, 6 minutes in all.**
- Local only: Ollama at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), version 0.32.14, as it is. No paid API, no model download, no model-setting
  change, no server restart. One model resident, nothing heavy beside a launch.
- The stall watch of the comparison runner reads the product's event stream: a model call quiet
  for 180 s ends the launch as an endpoint failure, recorded.
- No retry for a disappointing answer. Every attempted launch is recorded; none is replaced.

## Not given to either arm

The investigator's two-character control, the upstream patch, the hidden evaluator, the frozen
behaviour probe, any hint about the spelling, or any record of this document. Historical tool
observations enter only through the production account builder, in the treatment arm.

## Evaluation, frozen

On the exact delivered tree of each arm, apart:

1. **The hidden oracle**: the comparison runner's `hiddenVerdict` on a fresh checkout with the
   exact patch (the upstream autolink spec examples). It passed the incorrect candidate, so a pass
   alone is insufficient.
2. **The frozen behaviour probe**: [../../2026-10-19/requested-example/behaviour-probe.mjs](../../2026-10-19/requested-example/behaviour-probe.mjs)
   against its reference (`sha256:5a0cb1888b4a...`); the `ftp-bare` and `ftp-in-text` rows are
   the regression.
3. **The supplied acceptance check** (`npm run build:esbuild && node acceptance/visible/check.mjs`)
   and **the project's tests** (`npm test`), the runner's visible verdict.
4. **The product's own final verification and report** on the delivered tree.

**Decision rule, fixed now.** An arm "turned the candidate into a correct patch" only if its
delivered tree matches the upstream reference on every row of the behaviour probe and passes the
oracle, the supplied check and the project's tests. The treatment "helped" only if it did and the
control did not. Any other outcome, including both correct or both incorrect, is "no demonstrated
benefit", and then the handoff is not promoted to a default, no prompt rule is added, no budget is
raised and this task is not rerun. If the treatment helped, the change is retained with that
limited claim and a fresh-task evaluation is named as the next step.

## Reported

Per arm: readiness (timing, usage); whether the handoff happened as rehearsed (scripted turns
played, the forty-fourth request); the live attempts (steps, wall, tokens, edits, stop reasons);
the four evaluations; the product's report; task wall and tokens, probe wall and tokens, apart.
Then the decision above, what remains unproven, and the exact commits.

---

## Amendments

(none)
