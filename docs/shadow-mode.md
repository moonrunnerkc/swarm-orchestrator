# Shadow mode

Shadow mode runs `swarm audit` against a PR (or local diff) and writes
the verdict to disk without posting a comment, without affecting the
merge gate, and without exiting non-zero on a blocking finding. Use it
to dogfood the detector registry against your own repository's PR
traffic, then roll the per-PR outputs into a precision / recall
estimate to compare the audit's signal against the human merge
decision.

There are two output shapes; pick the one that matches how you plan
to consume the data.

## `--shadow-output <path>` (single-file)

Writes one JSON object per audit invocation. Useful when you are
running the audit as part of an existing CI step and want the result
captured next to other per-job artifacts.

```bash
GITHUB_TOKEN=... swarm audit \
  acme/widget#42 \
  --mode advise \
  --shadow-output ./audit-verdict.json
```

Schema:

```json
{
  "schemaVersion": 2,
  "prRef": "acme/widget#42",
  "auditedAt": "2026-05-24T18:30:11.000Z",
  "durationMs": 1234,
  "detectorVerdicts": [
    { "detector": "error-swallow", "version": "2.0.0", "fired": false, "severity": "none" },
    { "detector": "no-op-fix", "version": "2.0.0", "fired": true, "severity": "warn" }
  ],
  "judgeInvocations": 0,
  "renderedComment": "# Swarm Audit: ADVISORY\n..."
}
```

Fields:

- `prRef` is the literal positional or `--pr` value when the input was
  a PR, or `null` when the input was `--diff-file` or `--diff-stdin`.
- `detectorVerdicts` enumerates every loaded detector (default or
  experimental, depending on `--detectors`) with its pinned version
  string, whether it fired, and the worst severity it emitted.
  `severity: "none"` when `fired` is `false`.
- `judgeInvocations` counts the `llm-judge-result` entries written to
  the same run's ledger. Zero when the LLM judge is off.
- `renderedComment` is the exact body the gate-mode path would post.
  Shadow mode never posts it; capturing it here lets you diff future
  detector changes against the same input.

## `--shadow <repo-label>` (per-repo rollup)

Writes `<shadow-dir>/<repo>/<run-id>.json` so a downstream analyzer
can read every shadow audit for a given repo. Useful when you are
running the audit over many PRs in the same repo and want to roll
the per-PR verdicts into a precision / recall report.

```bash
GITHUB_TOKEN=... swarm audit \
  acme/widget#42 \
  --mode advise \
  --shadow acme/widget
```

Default output directory is `.swarm/shadow/`. Override with
`--shadow-dir <path>`.

Both flags can be passed in the same invocation; the single-file
output is written first, then the per-repo entry.

## Rolling up many runs

For the single-file form, accumulate the per-PR files into a
directory and post-process with `jq`:

```bash
mkdir -p audit-out
for pr in 41 42 43 44 45; do
  swarm audit acme/widget#${pr} \
    --mode advise \
    --shadow-output audit-out/${pr}.json
done

# count detectors that fired across the sweep
jq '[.detectorVerdicts[] | select(.fired)] | length' audit-out/*.json \
  | awk '{s+=$1} END {print "total fires:", s}'

# precision-by-detector requires joining against the human merge decision;
# the per-PR JSON is just the raw signal half.
```

For the per-repo form, the `listShadowEntries` helper in
[`src/audit/shadow.ts`](../src/audit/shadow.ts) returns every entry
under a given `<shadow-dir>/<repo>/` directory.

## Comparing against the human merge decision

The audit produces a signal; whether that signal was useful is a
ground-truth question only the maintainer's merge / revert / review
history can answer. The typical post-shadow analysis joins the per-PR
verdict against the PR's eventual state (merged, closed, reverted)
and reports per-detector precision conditioned on the human action.
The 205-PR `benchmarks/real-corpus/` corpus and the
`benchmarks/real-corpus/labels-v2/` scaffold are the in-tree workflow
for that join; the shadow-output files are the per-PR raw material a
maintainer would label.
