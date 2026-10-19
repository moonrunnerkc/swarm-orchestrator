# Requested outcomes and thrown cases: one development launch, protocol

Registered before the launch, after the deterministic verification of the tested commit. Every
launch, in order, goes in [launches.md](launches.md), entered before it starts, failed starts and
accidental launches included. This file is not edited after the launch; a change of plan is an
amendment appended below the line at the end, dated, before the launch it affects. The closed
protocols of [../coverage-and-reserve/](../coverage-and-reserve/protocol.md) and those before it,
and their results, stand unchanged.

## What this can show

One development launch on `marked-bugfix-www-case`, the task whose D1 launch this work's
diagnosis read. Its failure, its records and the upstream change are known to the people
developing Swarm, and its hidden oracle has been reported, so a pass is a development result,
never comparative evidence and never a measure of general correctness. A deterministic replay
already shows how the controller treats D1's recorded evidence ([README.md](README.md)); this
launch shows only what one fresh run of the local model does with the changed product.

## Allowance

- **One launch, at most 15 minutes end to end** (the runner's deadline 14 minutes and half a
  second, its kill at 15 minutes). No replacement for a valid product failure: a launch is
  replaced only if it fails for an infrastructure reason (the endpoint died, the runner halted on
  its own failure, a workspace could not be prepared), investigated and entered first, and then
  once.
- Local only: Ollama at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine. No paid API, no model download, no benchmark or
  comparison campaign. One model resident, nothing heavy running beside the launch.

## The product build

The tested commit recorded in [verification.md](verification.md), cloned into
`~/.cache/swarm-comparison/tools/swarm-<commit>`, built there with `npm ci` and `npm run build` on
Node 24.15.0, and its `dist/cli.js` digested into the manifest. No product code changes between
registration and the end of the launch.

## Launch mechanics

Through the comparison runner unchanged (`scripts/comparison/run.mjs --manifest`, its harness
digest in the manifest), as D1 was: a fresh clone of the task's frozen base with the visible check
committed, the supplied contract holding the visible check only, Swarm with `--plan-checks`, the
same limits as D1 (14 minutes and half a second, a 59.5-second grace, no correction, an 8,000,000
token safety bound). The model sees the task text, the repository at its base with the visible
check, and what the product itself says: no reference patch, hidden test, evaluator file, earlier
candidate, D1 record or developer-written check of the missed case. The manifest is frozen by
[freeze.mjs](freeze.mjs) before the launch.

## Evaluation, frozen with the task

The task's hidden oracle (`test/specs/new/autolinks.md` and `.html` from the upstream commit
`626d961335c9`, run by `node --test --test-name-pattern=autolinks test/run-spec-tests.js`),
through the runner's own `hiddenVerdict` on a fresh checkout with the exact delivered patch,
after the launch ends.

## Reported, separately

1. Whether the requested outcomes stayed represented: the outcomes recorded before admission, the
   reconciled per-outcome coverage, and which were unresolved and why.
2. Whether the checks executed correctly: each admission decision, with where any thrown case was
   thrown.
3. Whether final verification completed on the delivered tree.
4. Whether the exact delivered patch passed the hidden oracle.
5. Whether the product's report matched the evidence: its status, its scope line and the
   unresolved outcomes in the brief, the report and the JSON, against 1 to 4.
6. Wall, tokens and any repair contribution.

If the launch fails, its first concrete failure is identified from its own records and recorded,
and nothing is relaunched.

---

## Amendments
