# Troubleshooting

## `blocked      no model ...`

No installed model was ready. Run `swarm doctor --models` to see each model's verdict: too large
for memory at the context tried, not answering, or not following the reply protocol. Install a
model with Ollama, lower `--context`, or name a server with `--endpoint` and `--model`.

## `blocked: no independent check for R1 ...`

Nothing could show the task done: the drafted check was refused when run against your
repository as it is, and no existing test fails today. The message quotes the reason. Supply a
test that fails today with `--accept <file>` or `--accept-cmd "<command>"`, or draft one with
`--write-checks <dir>` and edit it.

## `your checks were refused: ...`

A check you supplied cannot witness the change. The usual reasons:

- It passes already. A check for the task must fail before the change. For behavior that must
  not change, pass it as `--accept keep=<file>`.
- The test runner did not collect it or could not parse it. Run it yourself first.
- A `keep=` check fails already.

## `a check was supplied for R<n>, which this task does not have`

`--accept R2=...` names a requirement that does not exist. Requirements after R1 come from list
items in the task or from `--require "<words of the task>"`. The message lists the ones this
task has.

## A requirement is `unverified`

Nothing independent showed it either way. The report's limitation column says why. Common cases:

- `the task asks for tests, and the change adds none ...`: the task's wording asked for tests
  and the model did not add one that fails before the change and passes after it.
- `has no independent check`: the drafted check for that item was refused. Supply one with
  `--accept R<n>=<file>`.
- `self-attested`: the only evidence is the model's own tests.

## `stop  no-progress: ...`

The model stopped changing anything. The line names the requirement still failing or the tests
the change broke. The patch is still delivered and reported. Try a larger model
(`swarm doctor --models` shows what is installed), a larger `--context`, or a narrower task.

## `the verifier did not publish its evidence`

The verification ran but its record could not be signed or written, so the run is reported
incomplete. The note gives the verifier's reason. A common one is an unreadable
`SWARM_SIGNING_KEY`.

## The patch was not applied

`applied  no: ...` gives the reason. Your working tree changed during the run, or `--no-apply`
was passed. Apply it yourself with `git apply <patch>`.

## Isolated verification fails to start

A container run needs a docker daemon with memory and CPU limits available. Start Docker Desktop
or `colima start`, or pass `--host` and accept a result reported as not isolated.

## `swarm doctor` reports a development link

A checkout linked with `npm link` owns the command. `swarm doctor --fix` removes it and installs
the published package.

## Reporting a problem

Open an issue with the `swarm --version` output, the summary the run printed and, if you can
share it, the session's `final/report.md`. See [SUPPORT.md](../SUPPORT.md).
