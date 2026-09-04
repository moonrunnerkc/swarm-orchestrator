# Credibility pass, 2026-09-04

One unattended session on `v13-main`, run through the phases of the credibility pass in order.
Each phase writes its findings here before its commits, and a phase that stops writes why. The
phase numbering is the pass's own; nothing below is a claim about the tool that
`claims.md` does not make.

## Phase 0: orientation

Recorded before anything changed, at 21:05 UTC.

### The tree

| Check | Result |
| --- | --- |
| Branch | `v13-main` at `a5d3c431`, equal to `origin/v13-main` |
| `package.json` version | 13.1.9, the last published tag; no 13.2.0 bump exists |
| `CHANGELOG.md` | carries an `Unreleased` section already, with the wall budget, the sealed criteria, the bonds and the re-derivation script |
| Node | v24.15.0 |
| Working tree | clean of tracked changes; 43 untracked result records and 43 untracked bundles under `campaign/campaigns/fixed-cli/`, the second campaign's `local-mlx` arm as far as it ran, see below |
| `main` | `78d5c8c9`, an ancestor of `v13-main`: it was fast-forwarded onto this lineage on 2026-09-01 and its `README.md` is the v13 one. The v12 auditor is the tag `v12-final` at `b3a06b84` |
| GitHub default branch | `v13-main` already |
| Repository description | already the v13 sentence, the one the README opens with |
| Topics | none of `pr-audit`, `merge-gate`, `cheat-detector`, `github-action`, `aibom`, `eu-ai-act` is set; the twenty set are v13 topics |

### The campaign

A driver exists, `campaign/harness/campaign.mjs`, with its method in `campaign/methodology.md`
and its rules in `campaign/criteria.md`, and it has run twice. Its arms are backends, not task
kinds: every repository carries one seeded defect from a sealed operator list, and an arm is
which model served the same task. There is no chore arm and no impossible arm in the driver.

| Campaign | Arm | Records | State |
| --- | --- | --- | --- |
| first, CLI of 2026-09-02 | `local-mlx`, qwen3.8:27b on rapid-mlx | 50 of 50, 43 executed, 7 bundle-less | committed, `campaign/results/report.md` |
| first | `local-ollama`, qwen3.6:35b-a3b on Ollama | 50 of 50, all executed | committed |
| first | `frontier` | 0 | NOT-DONE by decision: no funded key |
| `fixed-cli`, CLI of commit `2ba91651` | `local-mlx` | 44 of 50, the preflight committed and 43 untracked; the six missing are the Rust repositories `ajeetdsouza/zoxide`, `dandavison/delta`, `imsnif/bandwhich`, `sharkdp/bat`, `sharkdp/fd`, `sharkdp/hyperfine` | stopped at 14:52 UTC today when rapid-mlx went down; the backend is not running now and its launchd job is unloaded |
| `fixed-cli` | `local-ollama` | 1 of 50, the preflight | not started |
| `fixed-cli` | `frontier` | 0 | NOT-DONE by decision |

The empty-turn abstention landed in commit `643a91e6` on 2026-08-31. Every campaign run is
dated 2026-09-03 or later, so no campaign record predates that fix and none is stale on that
ground. The 43 untracked `fixed-cli` records are post-fix and are kept.

### The empty-turn issue

Diagnosed in `docs/empty-turn-diagnosis.md`, with the two shapes it took, the instrumentation
built for it, and the replay of 2026-09-02 that sent the failing request by prompt digest to
the live backend and got a full answer. What is in the tree:

- `src/evidence/turn-content.ts` classifies every assistant turn at the point it becomes a
  ledger record, and `src/select/calibration-run.ts` reads `executed` off those records: a
  repeat with no valid turn is `abstained` with a reason code and never scored.
- `src/evidence/fixtures/empty-assistant-turns.json` holds the two turns exactly as the
  08-23 and 08-24 ledgers recorded them, and `src/select/empty-turn-regression.test.ts` replays
  them through the real calibration repeat and asserts the abstention reaches the record.
- The cause is located outside the tree: the backend as served in August. Nothing in
  `src/providers` or the SDK changed between the day it failed and the day the same request
  answered.

What is not in the tree: a case in `src/evidence/redteam-adversarial.test.ts`, which is where
the pass wants the lock; and a dated stale header on the two calibration reports that predate
the fix, `docs/evidence/2026-08-18/calibration-report.md` and
`docs/evidence/2026-08-23/calibration-report.md`. Both say they are superseded; neither says
its numbers were scored with empty turns folded in.

### The session ratchet

`docs/ratchet-inputs.md` is the inventory: every input `judgeRatchet` reads, classified. Two
were authorable and are resolved with attack tests, the counters read out of stdout
(`src/gates/ratchet-trust-boundary.test.ts`) and the base ref the workspace could move
(`src/gates/base-commit.test.ts`); `src/gates/report-forgery.test.ts` locks the coverage and
TAP destinations. One is named there as a boundary rather than a gap: a gate's pass or fail
comes from the exit code of a command that runs workspace code.

`docs/tech-debt.md` carries the session-shaped one under "a session's ratchet is per turn":
a later turn dropped the `test` script from `package.json`, its tests gate reported
not-applicable, and nothing compared that to the turn before, which had passed. Not built,
with the design question named: whether a floor carried across turns blocks or reports.

### The tools this pass can use

| Tool | State |
| --- | --- |
| `claude` | on PATH, 2.1.261; `claude -p "print ok" --output-format json` ran headless and answered, model `claude-fable-5-1`, listed cost 0.21 USD for that one call |
| Cursor | no CLI on PATH and no application installed |
| Ollama | 0.32.14 on 11434, serving `qwen3.6:35b-a3b` among 21 models, and answering the Anthropic `/v1/messages` shape as well as the OpenAI one, which is what lets a headless `claude -p` run against the same local model the swarm arm uses |
| rapid-mlx | down; its launchd plist is on disk and unloaded |
| Frontier keys | present in the repo-root `.env`, authenticate, no balance, and the standing decision is not to fund them |

That last row decides Phase 4's shape: the baseline arm runs Claude Code headless against the
local backend, on the same model the swarm arm uses, and Cursor is NOT-DONE.

## Phase 1: empty-turn corruption

### Reproduction

Deterministic and already in the tree: `src/evidence/fixtures/empty-assistant-turns.json` is
the two model-call payloads copied out of the 08-23 and 08-24 ledgers, and
`src/select/empty-turn-regression.test.ts` replays them through the real
`runCalibrationRepeat`. The replay helper now lives beside the fixture, in
`src/evidence/fixtures/empty-assistant-turns.ts`, so the regression test and the adversarial
suite read one copy.

### The path, and the wrong assumption

1. The backend answers a streamed chat completion with no content delta and no tool call. For
   the shape that mattered, `finish_reason: other`, zero input tokens and zero output tokens,
   so no usage chunk arrived either: the stream ended before it said anything.
2. `src/providers/ai-sdk-model-client.ts` drains the stream and assembles a `ModelResponse`
   with empty text and no tool calls. It raises on an error part, and there was none.
3. `src/evidence/model-call-recording.ts` writes the `model-call` record. Before commit
   `643a91e6` that record carried no verdict on whether the turn held anything.
4. `src/core/loop.ts` reads a turn with no text and no tool call as `empty-response` (or
   `output-cap` where the finish reason was `length`) and ends the loop.
5. `src/select/calibration-run.ts` ran the case's gate over the workspace, and wrote the
   `calibration-run` record with `gatePassed` from that exit code.
6. `src/select/calibration-summary.ts` folded that gate verdict into the model's gate-pass
   distribution and its per-case green count.

The wrong assumption sat between steps 4 and 6: that a loop that stopped is a run the model
made, so whatever the gate found afterwards is a fact about the model. Commit `643a91e6`
corrected it for the whole repeat: the recorder stamps a content verdict on every turn, the
run reads `executed` off those records, and a repeat with no valid turn is `abstained` with a
reason code that every reader filters on. This pass found the same assumption one level down
and closed it in `1d7fac84`: a repeat that answered, and was then cut short by the runtime
(`empty-response`, `model-error`, `interrupted`), had its gate run and scored. That is the
empty turn skipped and the score computed from the rest. Now the gate is not run for such a
repeat, `gatePassed` and `gateExitCode` are null on the record, the summary counts it as
`gateNotMeasured` beside `didNotRun`, the competency table counts it for nothing, the
comparison script prints it as cut short, and the screen has a third verdict word for it.

The cause itself is outside the tree, and stays there: the replay of 2026-09-02 sent the
byte-identical request, by prompt digest, to the same model on the current backend build and
got eight full turns. What this tree controls was unchanged between the two days.

### The STOP condition

Not met. The harness accepted nothing it should not have: no model text authored a verdict,
and no record was trusted from the wrong source. It misread an absence as a measurement,
which is a harness-side scoring defect and not a trust-boundary breach.

### Regression tests

- `src/evidence/redteam-adversarial.test.ts`, case 18, two forms: the empty turn as the whole
  repeat, and the empty turn ending a repeat that had answered. Run against the previous
  commit `e47202f7` in a throwaway worktree, both fail (`gatePassed` was `false` there and
  the gate command ran); on `1d7fac84` both pass.
- `src/select/empty-turn-regression.test.ts` gained the mid-run case with the record
  assertions, and asserts that an output-capped end still measures the gate, since spending
  the budget on nothing is the model's own end to its run.

### Stale

`docs/evidence/2026-08-18/calibration-report.md` and
`docs/evidence/2026-08-23/calibration-report.md` carry a dated header naming both commits and
saying their numbers are not to be cited; the `claims.md` row that names them says the same.
No campaign record predates the fix. The 08-24 bundle the fixture also came from was never
committed and needs no header.

Commits: `1d7fac84`, `710e63b4`.

## Phase 2: session ratchet trust-boundary gaps

Each gap as one line: what the code under measurement could author that the harness then
trusted. The full write-up of each is in `../ratchet-inputs.md`.

| Gap | What the tree could author | Moved to | Attack test | Fails on the commit before |
| --- | --- | --- | --- | --- |
| A session's next turn reads its gate commands from the manifest this turn wrote | the tests command, and whether the harness's own reporting vector is used at all | the commit the session started on, sealed once before the first turn, every turn under that seal | `src/evidence/redteam-adversarial.test.ts` case 19 | `6aca0bb9`: turn two green under `# pass 1` printed by a `node -e` the first turn wrote into `package.json` |
| A parallel run's later layer reads its gate commands from the integration tree the earlier layer landed | the same, one level up, for the merge queue and for every worker branched from a later head | the commit the run branched from, for every layer and every worker | `src/workers/merge-queue.test.ts`, the two-layer case | `6aca0bb9`: the second layer's broken function landed under the first layer's rewritten script |
| The verifier held a gate run to the sealed id, severity and rule, and not to its command; and read the final cycle as the highest attempt number on the chain | a run under another command than sealed still conformed; an earlier turn's retry stood in for a later turn that dropped a gate | the sealed command is held too, and the final cycle is the last run of gate records under one attempt | `src/evidence/seal-conformance.test.ts` | `6aca0bb9`: both cases |
| Not-applicable was decided by a pattern over stderr as well as by the exit code | a failing suite stood down by printing `x: not found` | the exit code alone, with a program the harness could not start reported by the spawn error | case 20; `src/gates/killed-command.test.ts` | `6aca0bb9`: read as not applicable |
| A gate killed at its timeout was not applicable, which never blocks | a hung suite stood down, and the run green on the gates beside it | a kill is a failure of the gate that ran, with the reason in its output | case 21 | `6aca0bb9`: `isGreen` true with lint passed and tests hung |

The refined-github run of the first campaign's Ollama arm is the fourth gap as it happened in
the wild: its test script ran a missing `rg`, exited 0, and the gate was recorded not
applicable on the printed line. The corpus stands as recorded, and the bundle re-derives
under the `rederive.mjs` it carries, which is the rule it was written under.

Not moved, and named as a boundary rather than a gap, in both `../ratchet-inputs.md` and
`../build-guide.md` 7.1:

- **A gate's pass or fail is the exit code of a command that runs workspace code.** Closing
  it means the harness trusting nothing the project's runner says, which means not running
  the project's tests at all. What bounds it stays: no green over a change no command gate
  ran on, the numeric arms under the boolean one, and the boolean one now authored by nothing
  but the exit code.
- **A test that exits 127 on purpose stands its gate down.** 127 is the shell's word for a
  program it could not find and the harness cannot tell the shell's from a child's. That
  never renders green on its own and is one visible line in a diff. Reading anything but the
  exit code to tell them apart was the defect closed above.

The STOP condition, that closing a gap would require trusting something new, was not met:
every move reads less than before, not more. The tech-debt entry for the per-turn session
ratchet is closed at the cause, with the reasoning recorded there.

A defect found on the way, in the same commit: a session of more than one turn sealed its
criteria once per turn, and the verifier refuses a bundle with two seals, so every multi-turn
session bundle since sealing landed on 2026-09-02 failed verification. Case 19 asserts one
seal and a clean conformance over a two-turn chain.

Commits: `bd7ab8fc`, `98dbdf9d`, `7c6c8f91`, and the write-up above.
