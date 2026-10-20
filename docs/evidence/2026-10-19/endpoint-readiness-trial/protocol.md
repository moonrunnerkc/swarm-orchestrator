# One planned-check development trial under endpoint readiness, protocol

Registered before any live inference probe and before the launch, after the deterministic
verification of the tested commit ([verification.md](verification.md)) and after the model server's
one recorded recovery ([ollama/](ollama/service-after.json)). The launch, every readiness sequence
and any failed start go in [launches.md](launches.md), entered before they start. This file is not
edited after the first probe; a change of plan is an amendment appended below the line at the end,
dated, before what it affects. The closed protocols of
[../requested-example/](../requested-example/protocol.md) and those before it, and their results,
stand unchanged.

## What this can show

One development launch of Swarm with `--plan-checks` on `marked-bugfix-www-case`, the task whose
earlier launches this work's diagnosis read. Its failures, its records and the upstream change are
known to the people developing Swarm, and its hidden oracle has been reported, so this is a
development result on an exposed task. It is not a paired comparison, it establishes nothing about
Swarm against another agent, and it does not establish a benefit of `--plan-checks` on other tasks.

What it can show, launch by launch: whether the endpoint readiness that now precedes dispatch
admits a launch on a server that completes inference; whether the task's own example survives the
planner's revisions; whether a revision runs, is unnecessary or is withheld; whether the follow-up
on unresolved outcomes runs; whether any repair improves correctness; and whether the delivered
patch is correct. A correct first candidate does not show the follow-up works live when no follow-up
occurs; exercised and unexercised mechanisms are reported apart.

The delivery objective is a correct patch with completed final verification and accurate reporting
within budget. A correctly labelled wrong patch does not meet it.

## Allowance

- **One marked task launch** with `--plan-checks`, at most 15 minutes end to end (14 minutes and
  half a second of wall, a 59.5 second grace for the kill). No replacement launch for any failure,
  valid or infrastructure.
- **Readiness:** at most two sequences before the launch, each at most 90 seconds and at most
  three inference requests, through the comparison runner's own readiness. If neither sequence
  completes the round trip, nothing is launched and the halt is the result.
- **Twenty minutes** of aggregate probe and task wall time.
- Every probe request and its usage is recorded apart from the task's usage and retained in the
  total accounting.
- Local only: Ollama at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine, server version 0.32.14, as recovered once before this
  protocol. No paid API, no model download, no configuration tuning, no restart during the trial.
  A second wedge is a recorded infrastructure failure.
- One model resident, nothing heavy beside the launch.

## The product build

`826e60e83`, whose product source (`src/`, `packages/`) is `005d5eb8d`'s, the branch head's
product; the commits above it change the comparison harness, its fixtures and this evidence only.
Cloned into `~/.cache/swarm-comparison/tools/swarm-826e60e83`, built there with `npm ci` and
`npm run build` on Node 24.15.0 ([verification.md](verification.md)). The manifest digests its
`dist/cli.js` and its whole `dist/` tree ([freeze.mjs](freeze.mjs)). This is a different build
from the earlier trial's `b470b55e2`: it carries the bundle verifier and run-assessment lifecycle
corrections found by that trial's launch 1 (scope amendments 1 and 2 of
[../requested-example/scope.md](../requested-example/scope.md)). It is not described as the
earlier build.

## Launch mechanics

Through the comparison runner at `826e60e83` (`scripts/comparison/run.mjs --manifest`, its harness
digest in the manifest): a fresh clone of the task's frozen base with the visible check committed,
the supplied contract holding the visible check only, the same task text as the earlier launches,
the same model settings (thinking off, streamed with usage), 14 minutes and half a second of wall,
no scripted correction, an 8,000,000-token safety bound. The product is not given the reference
patch, the hidden evaluator, an earlier candidate or launch record, or a developer-written check
of the missed case.

**Request bounds, declared now from the recorded healthy latencies.** The earlier trial's ordinary
launch made 120 model calls on this model and build family; every one answered within 17.8 s
(first token within 13 s) with prompts up to 54,000 tokens, and the server's log holds no completed
request on this model above 1 minute 40 seconds. The calls the stalled launch waited on were quiet
for 249 s and 487 s and never reached the runner. So:

- an open model call of the arm quiet for more than **180 s** is a stall: the arm is stopped, the
  endpoint is probed once the arm is gone, and the launch is halted as an endpoint failure;
- each readiness request has **30 s**; a sequence has **90 s**; at most **2** sequences.

A long but healthy prompt evaluation is inside these bounds by an order of magnitude; nothing
shorter than the recorded healthy maximum is treated as a hang.

## Evaluation, frozen

- **The hidden oracle:** as the earlier trial's, through the runner's own `hiddenVerdict` on a
  fresh checkout with the exact delivered patch.
- **The behaviour probe:** [../requested-example/behaviour-probe.mjs](../requested-example/behaviour-probe.mjs),
  unchanged, against its frozen reference [../requested-example/probe/upstream.json](../requested-example/probe/upstream.json)
  (digest `sha256:5a0cb1888b4a...`), reporting the task's example, bare and inline `ftp://`, the
  `www.` spellings, email, `HTTP://FOO.COM` and the angle-bracket mixed-case scheme.
- The project's own test suite, as the runner's visible verdict reports it.

## Reported

1. Whether inference was restored (the readiness sequences, with timing and usage).
2. Whether the task's example survived planning revisions; whether a revision ran, was unnecessary
   or was withheld; whether the follow-up ran; whether any repair improved correctness.
3. The behaviours probed and the hidden oracle's verdict on the exact delivered patch.
4. Whether final verification completed on the delivered tree, and the product's report against
   1 to 3.
5. Task wall and tokens, and probe wall and tokens, apart.
6. Exercised and unexercised mechanisms, listed apart.

If the task fails, the earliest concrete product failure is identified from the records. If the
server fails, the infrastructure failure is identified. No planning rule is added and nothing is
rerun on the strength of this result.

---

## Amendments

### 1. 2026-10-20, after the launch: closed

One launch, 13.0 agent-minutes, one readiness sequence, 13.1 of the 20 minutes used; no allowance
remains and nothing else will be launched under this protocol. The launch is a valid product
result: the server completed every request (149 in the window, all HTTP 200, the longest 47.1 s),
readiness admitted it in 3.1 s, no request stalled and nothing was halted. The patch passes the
frozen hidden oracle and fails the task's own words on `ftp://`, which the product's generated
check detected and the product reported; see [launches.md](launches.md) and [README.md](README.md)
section 6. Nothing in the product changed during or after the launch.
