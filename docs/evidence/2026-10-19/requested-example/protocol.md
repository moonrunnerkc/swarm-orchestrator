# The requested example and the follow-up: a two-configuration development trial, protocol

Registered before either launch, after the deterministic verification of the tested commit
([verification.md](verification.md)). Every launch, in order, goes in [launches.md](launches.md),
entered before it starts, failed starts and accidental launches included. This file is not edited
after the first launch; a change of plan is an amendment appended below the line at the end, dated,
before the launch it affects. The closed protocols of [../outcome-coverage/](../outcome-coverage/protocol.md)
and those before it, and their results, stand unchanged.

## What this can show

Two development launches on `marked-bugfix-www-case`, the task whose earlier launches this work's
diagnosis read. Its failures, its records and the upstream change are known to the people
developing Swarm, and its hidden oracle has been reported, so these are development results on an
exposed task. They do not establish general comparative benefit, a benefit of `--plan-checks` on
other tasks, or anything about Swarm against OpenCode.

The delivery objective is a correct patch with completed final verification and accurate reporting
within budget. A correctly labelled wrong patch does not meet it.

## Allowance

- **Two launches, at most 15 minutes each end to end, and 30 agent-minutes in all.** Agent minutes
  are the arm's own process wall, from spawn to exit or kill; preparation, builds and scoring are
  reported apart. No retry or replacement for a valid failure. A launch that fails for an
  infrastructure reason (the endpoint died, the runner halted on its own failure, a workspace could
  not be prepared) is investigated and recorded as such; it is not replaced under this protocol.
- Local only: Ollama at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine, configured by the comparison runner as before. No paid
  API, no model download. One model resident, one launch at a time, nothing heavy beside a launch.

## Order, registered now

1. **Ordinary Swarm**, no `--plan-checks` ([manifest-ordinary.json](manifest-ordinary.json)).
2. **Swarm with `--plan-checks`** ([manifest-plan-checks.json](manifest-plan-checks.json)).

Both run, whatever the first gives.

## The product build

`b470b55e2`, the commit the deterministic verification ran on ([verification.md](verification.md)),
cloned into `~/.cache/swarm-comparison/tools/swarm-b470b55e2`, built there with `npm ci` and
`npm run build` on Node 24.15.0. Both manifests digest its `dist/cli.js` (`sha256:2bb07c9a9bf4...`,
an entry file whose bytes do not change with the modules it loads); the whole `dist/` tree, 862
files, digests to `sha256:783649fab763...` (the sorted per-file SHA-256 list, hashed). The comparison runner and this directory's scripts are the registering commit's; no
product code changes between registration and the end of the second launch.

## Launch mechanics, identical for both

Through the comparison runner unchanged (`scripts/comparison/run.mjs --manifest`, its harness
digest in each manifest): a fresh clone of the task's frozen base with the visible check
committed, the supplied contract holding the visible check only, the same task text, the same
model settings, 14 minutes and half a second with a 59.5-second grace, no scripted correction and
an 8,000,000-token safety bound. The two manifests differ only in the workflow flag and the launch
order. Neither configuration is given the reference patch, the hidden evaluator, an earlier
candidate or launch record, or a developer-written check of the missed case. Both manifests are
frozen by [freeze.mjs](freeze.mjs) before the first launch.

## Evaluation, frozen before either launch

- **The hidden oracle:** `test/specs/new/autolinks.md` and `.html` from the upstream commit
  `626d961335c9`, run by `node --test --test-name-pattern=autolinks test/run-spec-tests.js` through
  the runner's own `hiddenVerdict`, on a fresh checkout with the exact delivered patch.
- **The behaviour probe:** [behaviour-probe.mjs](behaviour-probe.mjs), on a fresh build of the base
  with the exact delivered patch, compares each listed input's HTML with what the upstream fix's
  own tree gives: the task's example `(See hTtPS://example.com/fhqwhgads.)`, bare and inline
  `ftp://`, inline `http://`, `HTTP://FOO.COM`, the three `www.` spellings, an email address and
  an angle-bracket mixed-case scheme. Its reference ([probe/upstream.json](probe/upstream.json))
  and the base's output ([probe/base.json](probe/base.json)) are recorded before the first launch.
  It reports behaviours; the oracle's verdict stays the verdict.

## Reported for each launch, separately

1. The requested mixed-case scheme behaviour (the task's example), and FTP preservation with the
   other probed behaviours.
2. The hidden oracle's verdict on the exact delivered patch.
3. Whether final verification completed on the delivered tree.
4. The product's status, its scope line and its unresolved outcomes, against 1 to 3; for the
   `--plan-checks` launch, the outcomes' task inputs, the revision's decision and whether the
   follow-up ran and what became of it.
5. Wall time and tokens, planning apart.
6. Whether any correction (a repair or the follow-up) changed an incorrect candidate into a
   correct one, scored by the probe and the oracle only where the candidate's exact bytes can be
   recovered from the records (a follow-up brief carries the candidate's diff against the base,
   when it is not truncated); otherwise named as not recovered.

If both fail, the earliest concrete shared failure is identified from the records before any
further planning feature is proposed. If planned checks fail while ordinary Swarm succeeds, that is
reported directly with a recommendation to keep the feature experimental. If both pass, cost is
compared and no quality advantage is claimed.

---

## Amendments
