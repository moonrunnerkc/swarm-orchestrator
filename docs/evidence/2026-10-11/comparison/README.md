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
- [records/](records): one JSON per launch, written once, with every command's argv and exit,
  output by digest, the invocations and their visible verdicts, the corrections, the final
  patch digest and the hidden verdict. Output blobs and final patches are kept under
  `~/.cache/swarm-comparison/blobs/` by digest.
- [results.md](results.md): the tables, produced by `scripts/comparison/analyze.mjs` from the
  records, and what they do and do not support.
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
| 5 | after amendment 3 | every launch again, both arms, under the re-frozen manifest | [results.md](results.md), [records/](records) |

The reasons, the fixes and the rerun decisions are in [protocol.md](protocol.md), amendments 1
to 3. Pass 5 is the comparison; passes 1 to 4 are reported because they happened.

## Status

See [results.md](results.md) for pass 5's launches and the counts.
