# Five developers, their own tasks: a lightweight follow-up protocol

Prepared 2026-10-11. Not run. This is the protocol and the recruitment text for an optional
real-user follow-up to the [exploratory comparison](evidence/2026-10-11/comparison/README.md).
Nothing here is an observation: no participant has been recruited, invited or observed, and
no number below is a result. Adoption and directly measured human time stay **pending** until a
run under this protocol is recorded.

The benchmark measures autonomous completion and scripted corrections on sealed tasks. This
follow-up measures two things the benchmark cannot: what a developer does around the tool on a
task of their own, and whether they pick it up again when nobody asks them to. It reuses the
[ten-minute first-run script](first-run-script.md) for the first session and the first-run
observation recorder (`scripts/observe-first-run.mjs`, schemas in
`src/eval/first-run-observation.ts`) for the record. No telemetry service, no recruitment
platform, no dashboard: one observer, one notebook, one JSON file per session.

## Who

Five external developers, not contributors to this repository, who have not used Swarm, read
this repository or seen a demonstration (declared by them, confirmed by the observer, both
recorded). Each brings a repository they work in and a task from their own backlog: something
they would otherwise do by hand this week, bounded enough to finish in a session (a bug, a small
feature, a refactor, a dependency bump). The same person never solves the same task twice: a
task done with the tool is not then done by hand for comparison, because the second attempt
would measure what they learned on the first.

## Week one: one session each

1. **Setup** (timed, from the first command): install, `swarm init`, the approval-mode question,
   the model choice. Every question the participant asks out loud is written down verbatim and
   answered with "do what you would do on your own".
2. **The task**, in their words, as `swarm "<task>" --plan-checks` on their own repository.
   What the planner proposes, whether they seal it, what they change in the text, and how long
   they spend reading the criteria are recorded.
3. **Monitoring**: whether they watch, walk away, or interrupt; every keyboard answer to a
   prompt; every restart.
4. **Review**: how long they spend reading the outcome block, the diff and the bundle, and what
   they say they believe, verbatim.
5. **Rescue**: anything they do by hand after the run (edits, re-runs, giving up), timed and
   described. A rescue is an intervention; so is a restart. The run's own repairs are not.
6. **Failures and withdrawals** are recorded as what they are, with the reason the participant
   gives, and count in the denominator.

Each milestone goes through the recorder with the participant's and observer's anonymized ids,
the build digest, consent, and the prerequisites (credentials supplied, model used, warm caches).
The recorder timestamps and refuses to replace an earlier observation.

## Week two: the choice

A second task of their own, the following week. The participant is told the tool is available
and nothing more; they are not asked to use it. What is recorded: whether they chose it without
prompting (**voluntary reuse**), chose it after being reminded it exists (**prompted reuse**), or
did not; and, if they used it, the same milestones as week one. Voluntary reuse is the adoption
signal; prompted reuse is reported separately and never folded into it.

## What is reported

Counts over five, with the denominator written out: sessions completed; tasks the participant
accepted the result of; rescues and restarts per session; setup time, review time and rescue
time as measured by the observer's clock; questions asked, verbatim; week-two choices, voluntary
and prompted apart; withdrawals with reasons. Human minutes are reported only as measured here,
never derived from the benchmark's scripted corrections.

## Recruitment text

Not sent. To be sent only by the maintainer, to people they already know or who have asked, one
at a time, never as a bulk or unsolicited message.

> I maintain Swarm Orchestrator, a coding agent that has to prove its work with sealed checks and
> an evidence bundle. I am looking for five developers who have not used it to try it on one
> task of their own, on their own repository, in a session of about an hour with me watching
> silently and writing down what happens; then, a week later, to do a second task of their own
> with the tool available but no obligation to use it. Nothing leaves your machine except what
> you choose to share; the record is anonymized and you can withdraw at any point, including
> after the fact. I cannot answer questions during the session, which is the point. If you are
> interested, reply and we will find an hour.

## Status

| item | state |
| --- | --- |
| protocol | prepared (this page) |
| recruitment | text prepared, not sent |
| participants | none |
| week-one sessions | 0 of 5 |
| week-two choices | 0 of 5 |
| adoption, human time | pending |
