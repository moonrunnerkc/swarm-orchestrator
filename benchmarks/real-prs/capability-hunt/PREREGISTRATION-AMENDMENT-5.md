# Capability hunt: pre-registration amendment 5 (three-column population, recall bounds)

Disclosed as an amendment to the standing pre-registration
(`PREREGISTRATION.md`, `2b9fc97d`), amendment 1 (`379cc399`), amendment 2
(`6f00fc4f`), amendment 3 (`96d9041b`), and amendment 4 (`72fe6de9`).

This amendment changes **presentation only**. It touches no bar, no threshold,
no outcome definition, no proven definition, no arm, and no holdout. The two
arms, the outcome taxonomy (`proven` / `advisory-found` / `abstained` /
`not-provisionable`), the strata, and the amendment-4 reporting split all carry
forward unchanged.

## Precedence: this amendment does not have it

The earlier amendments were frozen before any result they govern was seen.
This one was not, and it does not claim otherwise.

Two facts about when it was written:

1. The prompt that commissioned this session reports a partial recall pass 3 run
   in a Linux container: 21 records, of which 11 were audited entries, **0
   proven**, the batch dying mid-entry on `outline/outline#12197`. Those records
   are not present in this working tree at `84d6c6f0` and were never read here,
   but the summary of them (0 proven) was known before this file was written.
2. This file was written while the macOS pass 3 deterministic batch was already
   running, with its first per-entry records already on disk.

So the honest status of amendment 5 is: **a presentation rule adopted after a
zero was already known**, not a pre-registration. It is disclosed here rather
than applied silently. Every rule below either widens what must be published or
attaches an uncertainty statement to a number; none of them can turn a
non-result into a result, which is why adopting it after the fact is
defensible at all. A reader who wants only pre-result rules should read
amendments 1 through 4 and treat this one as a reporting note.

## (a) Population is reported in three columns

Every recall pass publishes, per slice:

| column | definition |
|---|---|
| **provisioned** | the sandbox cloned the repo and its dependency install succeeded |
| **controls-executable** | at least one proof control clause actually ran and returned a non-null result on that entry |
| **proven** | a self-certifying gate trigger fired and reproduced on a fresh replay |

These are three different sets, and they nest: proven is a subset of
controls-executable, which is a subset of provisioned. Two-column reporting
(provisioned and proven) overstated what was measurable, because an entry can
provision cleanly and still have every control return null, which means no
proof was ever attempted on it. Reporting only the outer and inner counts made
that entry look like a miss when it was never a trial.

The measured quantity is `controlsEvaluated` from the audit's own
`swarm-proof-coverage/v1` attestation, summed per entry: the number of control
clauses that ran rather than the number that were applicable.

## (b) A zero is published with its rule-of-three ceiling

Whenever **proven is zero**, the pass publishes a recall upper bound computed
from the **controls-executable** count, not from the provisioned count and not
from the population size.

The bound is the rule of three: with zero events in `n` independent trials, the
approximate 95% upper confidence bound on the event rate is `3/n`. The pass
states it as a plain sentence, for example:

> No entry was proven. With 12 entries on which at least one control executed,
> the 95% upper bound on per-entry recall over that slice is 3/12, or 25%. This
> is a ceiling on what the measurement could have detected, not a measurement of
> capability.

Two guards on this:

- When `controls-executable` is **zero**, no bound is published. `3/0` is not a
  bound, and a zero over zero trials says nothing was measured. The pass says
  exactly that instead.
- The bound is never restated as a recall estimate, a detection rate, or a
  performance number anywhere, including summaries, commit messages, and any
  external write-up.

## (c) The strict-9 holdout is unchanged

The permanent holdout rule of amendment 2 stands verbatim: the strict-9 are
never used to tune or debug engines; a miss there may motivate a fix, but the
fix is developed and validated on the legacy-19 and on synthetic injections
only, then measured once against the strict-9.

The Phase 2 engine work in this session (multi-ecosystem restoration-control
execution, so Go and Python repos can run a control at all) is motivated by
`jeduden/mdsmith#232`. That entry is in the **legacy** stratum, which the
holdout permits as a motivating case. No strict entry motivated, guided, or
validated that work, and no detector, threshold, or gate is changed by it: the
work adds an execution path where the answer was previously null, which is a
coverage change, not a sensitivity change.

## (d) Every published number carries its execution environment

A number is reported with the environment it was measured in: platform,
architecture, and the resolved Node, Go, and Python versions. Every per-entry
record written by a pass carries the same stamp.

Provisioning and controls-executable counts measured on **macOS arm64 are not
interchangeable with the Linux CI baseline**. The hunt runs on Linux; macOS is a
development convenience. Concretely:

- A provisioning or execution failure observed only on macOS arm64 is reported
  as an environment artifact and is **not** counted as an engine gap until it
  reproduces on Linux.
- A pass measured on macOS does not replace or restate a Linux-measured pass,
  and a comparison across the two names the environment on both sides.
- A proof produced on macOS is not published as a capability claim until it
  reproduces in the Linux CI, in addition to passing the four-check
  false-positive protocol.

## What this amendment does not do

- It does not change the proven definition, which still requires a
  self-certifying gate trigger that reproduces on a fresh replay.
- It does not change any detector, threshold, judge prompt, or gate policy.
- It does not change the population, the strata, or the amendment-4 rule that
  the v4 additions are reported on their own line and never summed into the v3
  headline.
- It does not retroactively restate recall pass 1 or pass 2. Those passes
  reported what they reported; where this amendment's columns can be recomputed
  from their committed records, the recomputation is labeled as such.
