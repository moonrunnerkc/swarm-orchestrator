# Stop controls for the comparison launcher: proof, 2026-10-14

The comparison launcher (`scripts/comparison/run.mjs`) now stops the campaign, before any later
launch, when the experiment rather than an arm fails. This directory holds the executable proof:
[manifest.json](manifest.json), derived by `scripts/prove-comparison-stop-controls.mjs` from the
fault-injection suite it ran, the timings that suite measured, the fingerprints of the files that
executed, the live smoke's records and the retained before-and-after evidence; and the retained
files under [blobs/](blobs). Nothing in the manifest is a success flag set by hand: its `result`
is `pass` only while every check it derives holds, and `--verify` re-derives the fingerprints
and the evidence digests against the current tree.

The contract the controls implement is amendment 4 of the comparison protocol,
[protocol.md](../2026-10-11/comparison/protocol.md): what is an arm's outcome (recorded, the
next launch runs) and what is a failure of the experiment (halt), by class.

## Result

**Stop controls proved for the documented failure classes.** 32 of 32 cases passed, every
measured detection and termination within its declared bound, the regression test failed against
the previous runner and the suite failed against a deliberately broken stop path, and the live
smoke completed 4 of 4 launches on the real arms with no halt.

## Source identity

| what | value |
| --- | --- |
| proof produced against | commit `af6ce8c3b3b51832613db60ee9286239c4865e1a` (branch `feat/comparison-stop-controls`, no tracked modifications) |
| code commit | `560b65b9c` Stop the comparison before any later launch when the experiment fails |
| contract and proof-script commit | `af6ce8c3b` Name the comparison's failure classes and stop contract, with its proof script |
| evidence commit | the commit that adds this directory (documentation only; the execution fingerprints are unchanged by it) |
| review baseline | `5d90162ab47e820555f81226313262a9bb0fd31c`, the tip of `v13-main` when this work began; pass 5 of the comparison ran before it and is untouched |
| harness digest (`scripts/comparison`, non-test modules) | `sha256:1386bcd95e8b6c5b910aa1409499ffe744bca566c6abcbfd01db51a6e23fd86d` |
| platform | macOS (darwin arm64), Node v24.15.0, OpenCode 1.14.48, rapid-mlx serving `qwen3.8:27b` at `http://127.0.0.1:8000/v1` |

The fingerprints (SHA-256) of the ten execution files and eight proof files are in
`manifest.json` under `source.fingerprints`; the full list is printed by `--verify`.

## Reproduction

```
# the fault-injection suite alone (about 60 s; spawns the real runner with fixture arms)
npx vitest run scripts/comparison/run.test.mjs scripts/comparison/control.test.mjs scripts/comparison/endpoint.test.mjs

# the whole proof, with the retained evidence and the smoke records
node scripts/comparison/fixtures/smoke-manifest.mjs --out <smoke manifest> --swarm-revision <rev>
node scripts/comparison/run.mjs --manifest <smoke manifest>
node scripts/prove-comparison-stop-controls.mjs --out docs/evidence/comparison-stop-controls \
  --before <saved failing output> --broken <saved failing output> --smoke-manifest <smoke manifest> --ci <url>

# does this proof still apply to the checked-out tree?
node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls
```

Supported platform: macOS with `lsof` and `ps` (the in-flight watch reads the endpoint's
listener). The suite runs under the default and `integration` vitest profiles; a host without
`lsof` cannot watch a listener and the mid-launch cases would not detect the fault.

## Failure classification and the limits

An arm that produces wrong or incomplete code, fails its checks because of its change, spends its
budget, stalls, is killed at the wall, refuses, or claims success the sealed oracle rejects, is a
recorded outcome and the next launch runs. The campaign halts on `endpoint`, `configuration`,
`preparation`, `scorer`, `records`, `interrupted` and `harness` failures, each defined in the
protocol amendment and in `scripts/comparison/schema.mjs` (`fatalClasses`).

| bound | declared | measured here |
| --- | --- | --- |
| detection of an endpoint process that stopped or was replaced during an invocation | 10 000 ms | 1 823 ms and 1 833 ms (poll interval 2 000 ms; the listener is read by `lsof` and `ps`, never by a request) |
| confirmed termination of the owned process group after the decision to stop | 10 000 ms | 1 ms, 2 ms and 4 ms from kill to the child's close event; the child's last heartbeat was 1 701 ms and 1 707 ms after the fault, and within one 200 ms heartbeat of SIGTERM |

What the controls do not see, stated as limits: a server that is alive and hung (the wall deadline
covers it); a remote endpoint, which has no local listener; an arm that is working against a
server that answers wrongly, which is the arm's outcome until some record disagrees; and any
defect of which the harness has no observation. SIGKILL of the runner runs no cleanup; the stale
lock it leaves is recognised on the next start, the orphaned child is stopped and the campaign is
halted for explicit recovery.

## Injected faults and what was observed

Every case drives `scripts/comparison/run.mjs` as a process with a temporary HOME, a disposable
endpoint process listing one model, a local mirror of a two-commit task repository and the
fixture arm in place of both products (`scripts/comparison/fixtures/`). Launch and correction
counts come from a log the arm appends to when it starts; the child's stop time from a heartbeat
file it touches every 200 ms. The per-case results and durations are in `manifest.json` under
`suite.cases`.

| fault | launches started | corrections | exit | halt class | cleanup |
| --- | --- | --- | --- | --- | --- |
| first task's install fails (the continuation defect) | 0 | 0 | 3 | preparation; attempt kept, 3 remaining | nothing running |
| endpoint absent before the first launch | 0 | 0 | 3 | endpoint; no launch named, 4 remaining | nothing running |
| endpoint lists another model | 0 | 0 | 3 | configuration | nothing running |
| installed OpenCode is another version | 0 | 0 | 3 | configuration | nothing running |
| pinned Swarm CLI bytes differ | 0 | 0 | 3 | configuration | nothing running |
| endpoint process killed mid-launch | 1 | 0 | 3 | endpoint, "stopped"; invocation kept with `SIGKILL(interrupted)` | terminated, 1 ms |
| endpoint restarted on the same port mid-launch | 1 | 0 | 3 | endpoint, "restarted" | terminated, 2 ms |
| hidden oracle's sealed file missing from the mirror | 1 | 0 | 3 | scorer; attempt kept as unjudgeable, no record | nothing running |
| arm prints nothing and exits 0; Swarm exits 4 | 1 each | 0 | 3 | configuration | nothing running |
| OpenCode reports "Unable to connect" while the endpoint is healthy | up to 2 (the Swarm cell may precede it) | 0 | 3 | configuration, attributed to the opencode arm | nothing running |
| manifest launch order the schema rejects | 1 | 0 | 3 | records; attempt kept, no record | nothing running |
| record directory made unwritable during the launch | 1 | 0 | 3 (stderr names EACCES; no halt record could be written); restart also refuses | nothing running |
| Swarm names an evidence directory that is not there | 1 | 0 | 3 | records | nothing running |
| wrong patch (visible check fails) on two tasks | 12 | 8 | 0 | none: 4 records, hidden fail, both arms' claims recorded against the oracle | scratch removed |
| arm stalls under a 1.5 s wall, healthy endpoint | 2 | 0 | 0 | none: 2 records with `SIGKILL(deadline)`, the wall note, hidden fail | scratch removed |
| arm's process ends on SIGTERM the harness did not send | 1 | 0 | 3 | interrupted | nothing running |
| SIGTERM to the runner mid-launch; then restart | 1; restart 0 | 0 | 143; restart 3 | interrupted; lock released | terminated, 4 ms |
| SIGKILL to the runner mid-launch; then restart | 1; restart 0 | 0 | restart 3 | interrupted, "without cleanup"; orphan terminated | orphan terminated |
| second runner on the same manifest | 1 (the first's) | 0 | 4 | none | the first continues |
| halt, recovery refused while the fault persists, recovery after repair, resume | 2, then 2 more | 0 | 3, 3, 3, 0, 0 | endpoint; `recovery-1.json` clears `halt-1.json`; the two completed records' digests unchanged | nothing running |
| healthy campaign, two tasks, both arms | 4 | 0 | 0 | none: 4 records, hidden pass, no lock, no scratch; a second run skips all 4 | scratch removed |

## Before and after

- [blobs/b1767a81130fa9fa.txt](blobs/b1767a81130fa9fa.txt): the regression test run against the
  runner as committed at `5d90162ab`, before any change. It fails because two further arms
  launched after the fatal preparation failure
  (`expected [ "opencode initial ...", "swarm initial ..." ] to deeply equal []`).
- [blobs/8668c7712f3c41c1.txt](blobs/8668c7712f3c41c1.txt): four cases of the suite run against a
  scratch copy of the harness whose halt path `continue`s to the next launch instead of
  returning. All four fail. The copy was removed afterwards; nothing in the tree carries it.
- `suite.log` in the manifest ([blobs/29b9eb20f57c0b84.json](blobs/29b9eb20f57c0b84.json)): the
  vitest JSON reporter output of the passing run, 32 of 32.

## Live smoke on the real arms

Two small development tasks on a local, dependency-free Node package (`smoke/duration`, created
by `scripts/comparison/fixtures/smoke-manifest.mjs`, mirrored under the comparison cache and
appearing in no measured campaign): a bug fix (seconds ignored by `parseDuration`) and a feature
(`formatDuration`). The smoke manifest ([blobs/e294f6fd3d1fcf4e.json](blobs/e294f6fd3d1fcf4e.json))
pins the actual arm configuration: `qwen3.8:27b` at `http://127.0.0.1:8000/v1`, the Swarm CLI
built at `7bd3e1aa` (bytes `sha256:e51fab44...`), OpenCode 1.14.48, Node v24.15.0, a 5-minute
wall per task and two corrections. Four launches, about 4 agent-minutes in all, out of the
allowed four and 20.

| launch | arm | agent wall | tokens | invocations | visible | hidden | record digest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| smoke-bugfix-parse-seconds | swarm | 50.1 s | 28 101 | 1, exit 0, 5 tool calls, 10 gate events | resolved | pass | `sha256:1a9ed1e15fa17...` |
| smoke-bugfix-parse-seconds | opencode | 67.4 s | 92 491 | 1, exit 0, tools read, edit, bash | resolved | pass | `sha256:5161bf0622558...` |
| smoke-feature-format-duration | opencode | 67.3 s | 115 739 | 1, exit 0 | resolved | pass | `sha256:71b19522dd715...` |
| smoke-feature-format-duration | swarm | 56.9 s | 28 744 | 1, exit 0 | resolved | pass | `sha256:cb54c5060edc3...` |

No halt, no correction, every workspace removed, Swarm's evidence directory present and scanned
with no mention of the sealed commit or mirror, OpenCode's sessions in its own store. The full
records, with every command's argv and output digest, are under
`~/.cache/swarm-comparison/runs/e294f6fd3d1fcf4e/` and are cited by digest in the manifest. The
model server was started for the smoke and stopped again afterwards.

## Restart and resume semantics

- The same `run.mjs --manifest` command refuses to continue while the campaign is halted (exit 3,
  naming the halt record). There is no automatic restart.
- `--recover --justification "<why>"` reads every pin again (harness digest, Node, the endpoint
  and its listed model, the Swarm CLI path and bytes, the OpenCode version), refuses if any fails
  (exit 3, nothing written), and otherwise appends `recovery-N.json` naming the halt it clears,
  that halt's digest, the justification and the observed values. The next ordinary run launches
  only cells without a record.
- A change to the harness, the model, the settings or the Swarm build is a new manifest under a
  dated amendment, never a resumption: an edited harness is refused at start (exit 2) and at
  every launch's revalidation. The pass-5 manifest is now such a case and is not relaunchable.
- Completed cells are never rewritten: every record, attempt, halt and recovery is written once
  with the exclusive-create flag.

## Continuous integration

- Gates on `5d90162ab` (the baseline): https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38458361566, success.
- Action controls on `5d90162ab`: https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38458361328.
  The first run's `controls (bad)` job failed at "Assert the original verifier outcome" because
  the verdict was not signed: the `actions/attest` step failed with
  `InternalError: error retrieving identity token` (`CI: no tokens available`), a GitHub OIDC
  failure on the runner. The verifier's own decision in that job was correct (`not-verified`,
  status 1, which the bad control expects), and `controls (good)` signed in the same run. The
  failed job was rerun unchanged on 2026-10-14 and both jobs passed, which is the evidence that
  the failure was transient infrastructure, not an incorrect verifier decision. The assertion
  that a push run must sign its verdict is kept as it was.
- The runs for the commits of this work are linked from the pull request or branch once they
  complete; this directory does not predict them.

## Known limits

Named above: a hung but living server, a remote endpoint, an arm fed wrong answers, SIGKILL's
absent cleanup, and any defect without an observation. In addition, the scorer's classification
leans on observation rather than inference: an unjudgeable tree stops for diagnosis rather than
being counted either way, so a campaign with a genuinely unapplicable patch will stop and need a
person to decide. The measured times are from one host under light load; they are bounds
observed, not guarantees.
