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
