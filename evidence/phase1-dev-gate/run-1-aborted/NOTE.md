# run-1-aborted — Phase 1 dev gate, partial evidence

This directory holds the partial evidence from the first attempt at the
Phase 1 dev gate. The run halted at obligation B1 due to an adapter
parser bug (see "Why this aborted" below). The full re-run is captured
under `run-1/` of this same directory; this folder is preserved
verbatim as audit evidence of how the first attempt failed.

## What completed

All eight Stratum A obligations (token-content absence) ran to
completion. Each returned three confirmed counter-examples, no false
positives. Aggregate Stratum-A line from
`run-1-aborted/summary.tsv`:

- 24 confirmed counter-examples across 8 obligations.
- 0 false positives.
- ~$0.349 USD (token-based estimate; ChatGPT-account auth is flat-rate
  subscription so this is informational, not real-billed dollars).
- ~111 s wall-clock total for Stratum A.

Per-obligation evidence is intact under `run-1-aborted/A1`–`A8/`:
`request.json`, `codex-stdout.txt`, `codex-stderr.txt`,
`codex-exit-code.txt`, and `result.json`.

## Why this aborted

Obligation B1 (`! find . -maxdepth 1 -name '.env' -type f`). Codex
returned three candidates: a regular `.env` with placeholder content,
an *empty* `.env`, and a `.env` containing typical secret-shaped
strings. The empty-`.env` candidate is a legitimate counter-example
— `find … -type f` does not read content; an empty regular file at
the forbidden path falsifies the predicate just as well as a
populated one.

The adapter's output parser
(`src/falsification/adapters/codex/codex-output-parser.ts`) was
rejecting the empty-bytes case with
`candidate "root-env-empty" file[0].bytes must be a non-empty string`.
The check came from a `requireString` helper used uniformly for both
`relPath` (where empty must be rejected) and `bytes` (where empty is
valid). The runner's
"no defensive try/catch around codex failures" policy then halted the
gate as designed — surfacing the real error rather than silently
treating it as a no-falsification-found.

This is an adapter binding defect, not a strategy issue. The codex
prompt is unchanged. No iteration of the falsification strategy is
spent on this fix; the "iterate strategy once" rule reserved by the
plan is preserved for genuine zero-yield outcomes.

## Fix and re-run

The fix splits the `requireString` helper into two:
`requireNonEmptyString` (for `relPath`, `name`, `rationale`) and
`requireStringAllowEmpty` (for `bytes`). A regression test in
`test/falsification/adapters/codex/codex-output-parser.test.ts`
asserts that an empty-`bytes` candidate parses successfully.

After the fix landed, the gate was re-run as `--run 1` against a
freshly-snapshotted HEAD. Its evidence lives under `run-1/` of this
directory.

## Files

- `B1/error.txt` — the captured error message.
- `B1/codex-stdout.txt` — codex's full response, including the
  `root-env-empty` candidate that the parser rejected.
- `B1/request.json` — the prompt and CLI args sent to codex.
- `A1`–`A8/` — completed obligations from Stratum A.
- `summary.md` / `summary.tsv` — aggregate (Stratum A only; B1
  errored before its row was written).
- `runtime.json` is **absent** because the runner only writes it on
  full completion. Intentional: a missing runtime.json signals an
  aborted run.

No fabricated evidence. The partial state is what it is.
