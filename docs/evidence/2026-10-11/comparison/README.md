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

## Status

See [results.md](results.md) for the launches run so far and the counts.
