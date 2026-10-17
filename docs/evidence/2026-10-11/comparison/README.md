# Exploratory comparison: Swarm Orchestrator against OpenCode on twenty mined tasks

Registered 2026-10-11 in [protocol.md](protocol.md) before any launch. Separate from the
registered campaign of 2026-09-29, whose population, pins, records and scoring rules are
untouched; this trial neither runs nor completes it.

## What was compared

Twenty issue-sized historical changes from five public repositories outside every earlier
corpus (markedjs/marked, NaturalIntelligence/fast-xml-parser, yargs/yargs-parser,
nodeca/js-yaml, isaacs/minimatch): 7 bugfixes, 4 features, 3 refactors, 6 upgrades. Two arms
on the same local model (`qwen3.8:27b`, rapid-mlx, thinking off), the same prepared workspace,
the same task text and visible check, the same 30-minute wall budget and one deterministic
supervision rule applied to both: Swarm Orchestrator at the pinned source revision with the
visible check sealed as a goal contract, and OpenCode 1.14.48 unattended with edit and shell
permission. Scoring is by the upstream commit's own tests, sealed from both arms. Every launch
is recorded once; failed, capped and infrastructure launches are retained.

## Files

- [protocol.md](protocol.md): tasks, arms, the supervision rule, measures, order and pins.
- [validation.json](validation.json): every task on its base (visible check and hidden oracle
  fail) and on its upstream reference (both pass), with no model, before the freeze.
- [manifest.json](manifest.json): the frozen task set with full commit ids, the pins, the
  budgets and the launch order; its digest is on every record.
- [records](packed-derived/records/inventory.json) (packed; restored by `node scripts/evidence-pack.mjs restore docs/evidence/2026-10-11/comparison/packed-derived/records`): one JSON per launch, written once, with every command's argv and exit,
  output by digest, the invocations and their visible verdicts, the corrections, the final
  patch digest and the hidden verdict. Output blobs and final patches are kept under
  `~/.cache/swarm-comparison/blobs/` by digest.
- [results.md](results.md): the tables, produced by `scripts/comparison/analyze.mjs` from the
  records, and what they do and do not support. The records are packed losslessly in
  [packed-derived/records](packed-derived/records/inventory.json); `node
  scripts/comparison/analyze.mjs --runs docs/evidence/2026-10-11/comparison/records` reads them
  from the pack and re-derives the tables.
- [results-pass2.md](results-pass2.md), [records-pass2.sha256](records-pass2.sha256) and
  [manifest-pass2.json](manifest-pass2.json): the failed second pass, its tables, the digests
  of its retained records and the manifest it ran under.
- [results-pass3.md](results-pass3.md), [records-pass3.sha256](records-pass3.sha256) and
  [manifest-pass3.json](manifest-pass3.json): the failed third pass, likewise.
- [records-pass4.sha256](records-pass4.sha256) and [manifest-pass4.json](manifest-pass4.json):
  the fourth pass, stopped after two launches.

## Passes

| pass | window (UTC) | what happened | where |
| --- | --- | --- | --- |
| 1 | 2026-10-11 20:27 to 22:13 | every launch an infrastructure failure: the harness scored against the wrong commit and the OpenCode arm exited at once (inherited `PWD`, global small-model setting). Harness defects, fixed before pass 2 | the `*.infrastructure-1.json` records beside pass 2's |
| 2 | 2026-10-12 00:01 to 08:57 | all forty launches completed and scored; afterwards, eleven Swarm launches were found refused by Swarm's own preflight before any model call and four more ended on Swarm or harness defects. Eight Swarm defects and two harness defects fixed at the root | [results-pass2.md](results-pass2.md), [records-pass2.sha256](records-pass2.sha256) |
| 3 | 2026-10-12 09:54 to 23:19 | all forty launches completed and scored; afterwards, every OpenCode launch was found to have lost the model endpoint mid-run (44 of 58 invocations), because the server died of GPU memory exhaustion whenever that arm's session-title call ran beside its first turn. Pass 2's OpenCode launches had the same failure, unseen at the time. Two harness defects fixed at the root, one OpenCode setting changed, the endpoint now watched | [results-pass3.md](results-pass3.md), [records-pass3.sha256](records-pass3.sha256) |
| 4 | 2026-10-12 23:54 to 2026-10-13 01:0x | stopped after two launches: the OpenCode arm held the endpoint but its model was thinking to the output cap and answering nothing, because the server enables thinking unless a request turns it off and only Swarm did; it had been so in every pass. Thinking off and the server's default top_p set for the OpenCode arm | [records-pass4.sha256](records-pass4.sha256), [manifest-pass4.json](manifest-pass4.json) |
| 5 | 2026-10-13 00:59 to 18:44 | all forty launches completed and scored, no infrastructure failure, one server process throughout, both arms with thinking off and the same output cap. This is the comparison | [results.md](results.md), [records](packed-derived/records/inventory.json) |

The reasons, the fixes and the rerun decisions are in [protocol.md](protocol.md), amendments 1
to 3. Pass 5 is the comparison; passes 1 to 4 are reported because they happened.

## Status

Pass 5 is complete: 40 of 40 launches scored, 0 infrastructure failures, manifest digest
`sha256:bf06dda83c15629a2067db1be6035521d7332585c5728dc45234a9c365fd6632`. The full tables are in
[results.md](results.md); the counts that matter, each over the 20 tasks per arm:

| measure | Swarm Orchestrator | OpenCode 1.14.48 |
| --- | --- | --- |
| correct completion (hidden oracle passed) | 5 / 20 | 4 / 20 |
| correct without a scripted correction | 5 / 20 | 4 / 20 |
| by work type, correct / tasks: bugfix, feature, refactor, upgrade | 0/8, 0/4, 2/3, 3/5 | 0/8, 0/4, 3/3, 1/5 |
| scripted corrections used (runs with 0 / 1 / 2) | 9 (14 / 3 / 3) | 1 (19 / 1 / 0) |
| reported success while the hidden oracle failed | 1 | 0 |
| launches ended by the 30-minute wall | 15 of 20 (Swarm's own wall stop) | 19 of 20 (killed by the harness) |
| agent wall time, correct runs only | 28.4 min over 5 | 95.7 min over 4 |
| tokens, all runs | 9.7 M | 191.6 M |
| tokens per correct task | 355 k | 4.76 M |

Paired by task: both arms correct on 3 tasks, Swarm only on 2, OpenCode only on 1, neither on
14. Every bugfix and feature task failed under both arms. The difference in correct completions
(5 against 4) is one task and supports no claim of an advantage either way; with 20 tasks and
these rates the trial could not have resolved a difference smaller than several tasks. What the
records do show, each with its denominator:

- **Supervision and rework.** OpenCode used one scripted correction in 20 launches because 19
  of its 20 first invocations ran until the harness killed them at the wall, most of them
  repeating one shell command turn after turn (eleven launches made more than 250 tool calls);
  a correction needs an invocation that returns. Swarm's launches returned on their own in all
  20 (its own wall stop in 15, its repeated-call stop in 2, completion in 3) and took 9
  corrections. The hypothesis "less supervision" is therefore not measured as fewer corrections
  here; it is measured as the arm that stops and reports against the arm that has to be killed.
- **Reporting.** Swarm's one wrong claim is the yargs-parser toolchain upgrade: its visible check
  and its own final verification passed and the upstream's lint under the upgraded toolchain
  did not. OpenCode claimed success in 1 of 20 and that claim was right; its other 19 claimed
  nothing because they were killed.
- **Cost.** 4.76 M tokens per correct OpenCode task against 355 k per correct Swarm task, and
  191.6 M tokens in all against 9.7 M, on the same model; the OpenCode figure is dominated by
  the launches that looped to the wall.
- **Long silent turns** in the OpenCode arm (16 turns at the 8192-token cap with no message and
  no tool call, in 6 launches) are, by the server's stream log for the pass, tool calls the
  model streamed to the cap without closing (53 of the 62 cap-length completions carried a
  tool-call stream, 35 of them to a tool named `search` that OpenCode does not offer); they are
  the model's behaviour under that arm's tool set, not the server's.

Pass 5 is the comparison. Passes 1 to 4 (above) are reported because they happened, and each
was stopped or discarded for a defect in the harness, in Swarm or in the server, never for a
result.
