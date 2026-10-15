# Development validation of the pilot repairs, registered 2026-10-15

Development checks on known tasks, not fresh comparative evidence and not a repetition of the
failed pilot. Their question is narrow: do the repairs made after the pilot (recorded in
[correction-2026-10-15.md](../correction-2026-10-15.md)) hold on the real product, the real
harness and the real model, under the conditions the pilot failed to establish? Their metrics are
kept apart from stage A's and pool with nothing. Everything below is frozen before the first
launch; each manifest carries this file's digest.

## Instrument

The comparison runner as repaired on this branch (`scripts/comparison`, digest in each
manifest), launching the product built in isolation from the repaired source (commit, CLI bytes
and dist digest pinned), against the same model, server, settings and OpenCode version as stage A.
One model request stream at a time; no test suite or other workload beside the server.

What is new since stage A and is exercised here: every launch gets a fresh home of its own
(Swarm's child processes through the name the product reads, OpenCode through HOME), with npm's
content-addressed store linked to one shared cache (declared on each record); before a Swarm
launch the product's own check runs over the prepared base under that home and must report the
task's test command as its blocking tests gate, passing; the amended upgrade oracle; and the
product's repaired budget and repair paths.

## Tasks and launches

The frozen tasks under new ids, so no cell can be read as a pilot cell:

| stage | cells | why |
| --- | --- | --- |
| dev | chai-upgrade-c8-v12-dev, both arms; chai-feature-deep-contain-oneof-dev, both arms | the two launches the pilot's setup failure touched, each once per arm, clean |
| dev-bugfix | csstree-bugfix-raw-value-whitespace-dev, Swarm | the pilot's failed delivery, once, with the repaired loop and no hint |
| dev-bugfix2 | csstree-bugfix-raw-value-whitespace-dev2, Swarm | a second independent launch, run only if the first correctly delivers (to see whether it repeats), or not at all |

At most six launches; the sixth is conditional as stated and no replacement launch is run. Each
launch has one 19-minute deadline covering its initial invocation and at most two scripted
corrections, with the runner's 60-second grace for cleanup, so agent time per launch stays under
20 minutes; at most 120 agent-minutes in all. No manual repair, no hints, no change to code or
settings between launches: a defect a launch exposes is preserved and diagnosed, and the remaining
launches are reported as not run.

## Stops

The runner's halt is final for this validation: an invalid experiment (endpoint, configuration,
preparation, scorer, records, interruption, harness) stops dispatch and the result is reported as
blocked with the halt record. A launch refused before dispatch because the product's effective
gate was not the task's, or because the declared prepared state did not hold, is such a halt. An
arm's own failure under a healthy setup is a recorded outcome.

## Scoring

The pilot's definitions: correct patch (the amended hidden oracle in a fresh checkout), correctly
delivered (correct patch, visible checks resolved, exit 0 within budget, a completion claim, for
Swarm its own acceptable verdict with evidence present and no oracle exposure), eligible for a
controlled comparison (the product's effective gate was the task's, no prerequisite installed
inside the task, no state prepared by another launch). Analysis: `node scripts/pilot/analyze.mjs
--evidence <stage directory>` over the published directory alone.

## What this can and cannot establish

Six launches on three known tasks can show that the repaired instrument dispatches, measures and
records as intended and whether the product delivers these tasks under the corrected setup. They
cannot establish added value over OpenCode, generalize to other tasks, or revise the pilot's
decision: the larger-study decision remains DO NOT PROCEED whatever happens here, and a bug fix
that is still not delivered is reported as the capability limit it is.
