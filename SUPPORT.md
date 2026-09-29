# Support

Where to go, what to expect, and who answers.

**Bugs and confusing setup**: open an issue with one of the forms
([verifier bug](https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?template=verifier-bug.yml),
[setup confusion](https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?template=setup-confusion.yml)).
A minimal reproduction, the version and the scrubbed evidence make the difference between a
question and a fix.

**Security**: privately, through [SECURITY.md](SECURITY.md).

**Who answers**: the maintainer, Brad Kinnard (`@moonrunnerkc`). New issues notify the
maintainer's GitHub inbox and email. An hourly workflow (`.github/workflows/triage.yml`, applying
`scripts/triage/policy.mjs`) labels an issue with no maintainer response after 24 hours `overdue`
and mentions the maintainer in a reminder comment, again every 24 hours until one is posted; after
72 hours it is also labelled `escalated` and assigned to the maintainer. The first maintainer
comment removes both labels and ends the reminders, so an unanswered report is visible as
unanswered and never goes quiet.

**What to expect**: a meaningful first response within 24 calendar hours of a report, which
may be a question, a reproduction, or a fix plan; a fix for a reproducible defect through the
ordinary gates, released as a compatible version, with the released version named on the
issue; and credit in the release notes if you want it. Response times, overdue reports and the
fixes that shipped are recorded in [the verifier-first index](docs/verifier-first/README.md).

**What this project will not promise**: an implementation for every request, a response on
a channel it does not watch, or a closed issue whose fix only exists on somebody's machine.

**Labels**: `verifier`, `docs`, `action`, `integration` for the area; `needs-triage`,
`reproduced`, `fix-released`, `cannot-reproduce`, `wontfix` for the state; `overdue` when
the response promise has lapsed.
