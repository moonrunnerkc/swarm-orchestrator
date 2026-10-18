# Declared files, 2026-10-18 follow-up to PR #89

Declared before the first edit of this work, on `fix/repair-trust-and-first-run` at
`e37d4300581343cdc5b413b9eab2ed8f1892f6b6`. Additions are appended below as amendments, each
naming every file it adds, before that file is edited.

## Initial declaration

Product, with tests beside them:

- `src/workers/planned-check-program.ts`, `src/workers/planned-check-program.test.ts`: the
  planned-check program's interface (what the default export is called with) and the runner.
- `src/cli-planned-checks.ts` and its tests: admission of planned checks by their base control.
- `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the planner's feedback and revision
  brief.
- `src/workers/planner-run.ts`, `src/workers/planner-run.test.ts`: the planner's tool
  descriptions and instructions, where they state the program interface.

Evidence and records:

- `docs/evidence/2026-10-17/repair-detection-live/README.md`,
  `docs/evidence/2026-10-17/repair-detection-live/launches.md`: an appended correction of the
  launch-5 diagnosis; the original text stays as written.
- `docs/evidence/2026-10-18/generated-check-control/` (this directory): the replay of the
  launch-5 checks, the development contract, the new protocol, its launch ledger and records.

## Amendments

### 1. Before the aggregation fix

The reproduction (`regressions/aggregation-before-fix.result.json`) shows a repair breaking one
supplied check while another was already failing, kept by the ratchet. Added:

- `src/gates/gate-definition.ts`, `src/gates/parsers.ts`, `src/gates/gate-runner.ts`: a gate
  may report named parts, each with its own status, as data.
- `src/gates/ratchet.ts`, `src/gates/auto-resolve.ts` and their tests: each part that passed
  before an attempt is held to the same no-regression rule as a gate.
- `src/evidence/verifier/rederive.mjs` and its test: the standalone verifier re-derives that rule.
- `src/cli-task-goal.ts`, `src/cli-planned-checks.integration.test.ts`: the acceptance gate
  reports each supplied check as a part; the reproduction is a regression test.

### 2. A fixture the new field reaches

- `src/gates/bond-runner.test.ts`: its hand-built gate cycle gains the empty `parts` map.

### 3. Tests of the parts reading

- `src/gates/parsers.test.ts`, `src/evidence/rederive.test.ts`: the inspection parser's reading
  of parts, and the verifier's re-derivation of the part rule.

### 4. Headroom for this work's evidence

The tracked tree stood 24 KB above its required 6.0 MB headroom, too little for any launch's
records. Packed as `ecbcff9d7` packed the fixed-cli corpus:

- `campaign/corpus/local-ollama/`: every tracked file, packed whole and losslessly into
  `packed-derived/local-ollama-corpus`, with a `README.md`; all 300 files restore byte for byte.
- `scripts/check-doc-paths.mjs`: the one path a document still names, listed as packed.

### 5. Before stopping repair on a check shown broken

The first form of this change let the diagnostics gate pass over a check shown broken, which
made the run read as accepted while a sealed check was rejected. The gate keeps failing; repair
stops by its classification instead. Added:

- `src/gates/repair-policy.ts`, `src/gates/repair-policy.test.ts`: an `instrument` failure class,
  read from a gate's `unrepairable` measure, which stops repair as setup failures do.
- `src/cli-planned-checks.test.ts`, `src/cli-plan-checks.test.ts`: the admission findings and
  control in unit tests, and a fixture that gains the two new fields.

### 6. After launch 3

No new file: the relation reminder lands in `src/workers/planned-check-program.ts`,
`src/workers/planner-run.ts` and their tests, declared above.

### 7. The measurement history

- `docs/agent.md`: one entry for this work beside 2026-10-17's, linking its README.
- `scripts/check-doc-paths.mjs`: the protocol's one mention of a file in the mime repository,
  named as such.
