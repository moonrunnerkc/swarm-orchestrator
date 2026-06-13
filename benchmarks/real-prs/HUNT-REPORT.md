# Wild hunt: pointing the proof tier at PRs we did not write

This is the record of a hunt for the proof tier's first proven catch on an
external PR, and the diagnosis of why the backward-mining path had returned
zero. Every number here points at a committed artifact or a reproduce command.

The proof tier fires a block only on a genuine, control-verified cheat, so on
presumed-clean PRs the expected count is zero. The question this hunt answers is
not "does it block a lot" but "when we point it at real agent PRs in repos it
can actually execute, does anything survive every control, and if not, why."

## TL;DR

- **The backward-mining zero was the instrument, not the world.** The funnel now
  shows the collapse stage explicitly. An adjacent run surfaced a real cluster of
  outcome-bad `claude-code` reverts; the original cron's zero came from a
  budget-burning duplicate API fetch, now fixed.
- **The structural reason gate precision is n=0:** `{outcome-bad} ∩ {EG-viable}`
  was empty in the existing corpus. The hunt set out to find a PR that is
  agent-attributed *and* execution-grounded-viable *and* a genuine cheat.
- Proven catches: **0** proven blocks on 28 execution-grounded-viable agent PRs (`benchmarks/real-prs/hunt/hunt-summary.json`). Two control defects that fired false positives on legitimate feature PRs were found and fixed during the hunt (see below).

## Part 1: the backward-mining funnel

The backward miner (`scripts/real-prs/mine-backward.ts`) starts from revert
markers in the wild, walks back to the reverted commit, keeps the ones an agent
authored, and confirms the outcome with the same `findOutcomeEvidence` the corpus
labeler uses. It had reported a bare `0 confirmed` with no way to see where the
funnel collapsed.

Decomposing the funnel found two instrument defects, not a clean world:

1. **A budget-burning duplicate fetch.** Every candidate fetched its reverted
   commit twice (once for the attribution author, once for the changed-line
   ranges), doubling the real API cost per candidate. The 1500-unit budget ran
   out after ~110 markers having confirmed nothing. Fixed: fetch once, reuse.
2. **No staged visibility.** Added a funnel (markers → candidates → pr-lookup →
   commit → author → agent-attributed → evidence-checked → confirmed) with
   per-stage drop reasons, emitted into `confirmed-bad-backward.json`.
3. **No secondary-rate-limit backoff** on the discovery search or the
   per-candidate core calls, so a burst stalled the bounded run past its wall
   clock without honoring `Retry-After`. Added a shared `withRetry`.

The committed full-budget run
(`benchmarks/real-prs/agent-corpus/confirmed-bad-backward.json`, `lastRun.funnel`):

| stage | count |
| --- | --- |
| revert markers scanned | 83 |
| reverted-sha candidates | 866 |
| candidates processed (post-dedup) | 758 |
| PR lookup resolved | 740 |
| reverted commit resolved | 740 |
| identifiable author | 676 |
| **agent-attributed** | **0** |
| evidence-checked | 0 |
| confirmed outcome-bad | 0 |

Drop reasons: `not-agent-attributed: 740`, `duplicate-candidate: 107`,
`pr-lookup-failed: 18`.

**Diagnosis: the funnel collapses at the attribution stage.** Plumbing is healthy
(740 of 758 candidates resolve to an authored commit); the collapse is that
agent-authored reverted commits are a needle in the haystack of all reverts.
GitHub holds ~826,000 commits matching `"This reverts commit"` in the last 18
months; the overwhelming majority revert human-authored commits. The miner also
still stops at `api-budget` after only 83 markers because each candidate spends
~2 units (PR lookup + commit fetch) before the cheap attribution check drops it,
so the budget is consumed proving that 740 reverts are of human commits.

**This is a yield that depends on which slice the commit search surfaces.** An
adjacent run (same code, same budget) surfaced a different slice that contained a
real cluster of outcome-bad `claude-code` reverts in
[`dculussoftwares/dculus-forms`](https://github.com/dculussoftwares/dculus-forms)
and mined 15 confirmed-bad entries before it was interrupted. So the instrument
*does* yield; the backward direction is simply low and non-deterministic in
yield, because agent reverts are rare in the global revert stream and cluster in
individual agent-heavy repos. The forward, targeted hunt below is the higher-yield
instrument for the same goal.

No entries were forced into the corpus. The committed funnel run stands at 0, with
the stage counts that make the next zero diagnosable at a glance.

## Part 2: the hunt

The hunt (`scripts/real-prs/hunt.ts`) extends the agent-incidence fetcher into
one bounded pass: assemble a target set of recent agent-attributed merged PRs
(reusing the fetcher's vendor queries and the shipped `detectAgent`
fingerprinter), screen each with the exact `screenPr` viability check the corpus
uses, and run the structural-and-judge advisory audit plus the six-engine
execution-grounded proof tier on the viable subset. Bounded by a GitHub API
budget, a total wall clock, a per-PR EG wall clock, and a cap on EG runs; work
dropped by a cap is recorded. Single-target, local, concurrency 1 (no CI dispatch
from this environment).

### Target set

The authoritative run (`benchmarks/real-prs/hunt/hunt-summary.json`) assembled
**216** agent-attributed PRs: 210 from the global per-vendor search (devin 35,
claude-code 49, cursor 35, codex-cli 34, copilot-workspace 35, aider 22) over a
12-month window in the 10..8000 changed-line band, plus 6 seed leads (the
`dculussoftwares/dculus-forms` reverted `claude-code` commits the backward miner
surfaced, carried in via `--seeds`). Every global candidate was confirmed by the
shipped `detectAgent` fingerprinter; 840 search candidates were examined and 59
dropped for falling outside the line band. 704 GitHub API calls, ~12.7 min wall
clock, nothing dropped by a cap.

### Viability

The intersection that matters is `{agent-attributed} ∩ {EG-viable}`: only a Node
project with a lockfile and a recognized runner provisions, and the EG layer can
only prove a cheat on a PR it can execute.

**28 of 216 are EG-viable.** The non-viable 188 break down as 113 not a Node
project (no `package.json`), 70 with no recognizable test runner, and 5 with
neither a lockfile nor a runner. This is the same ~6-13% viability the project
corpus measured, and it is the binding constraint on the hunt: the proof tier can
only execute a Node project with a lockfile and a jest/vitest/mocha runner.

### Proof tier

All **28** viable PRs provisioned and ran (0 provisioning failures, 0 errors, 0
skipped by a cap). **0 proven block triggers** (`engineFires: {}`). The six dculus
seeds are outcome-bad (reverted) `claude-code` commits in an EG-viable repo, so
they are exactly the `{outcome-bad} ∩ {EG-viable}` intersection the project corpus
lacked; the proof tier ran on every one and abstained (`ran-no-proof`), because a
revert is a genuine regression or rolled-back feature, not one of the six
control-verifiable cheats (a reverted real fix breaks an affected test when
reverted, which refutes rather than proves a no-op).

The structural-and-judge advisory audit flagged, across all 28: no-op-fix 67,
coverage-erosion 120, type-suppression 2, mock-of-hallucination 2. None survived
the execution-grounded controls. Per-PR records:
`benchmarks/real-prs/hunt/records/<id>.json`.

### Two control defects found and fixed during the hunt

Before the final run, the proof tier fired two proven blocks that the stop-the-line
protocol (replay in a fresh clone, read the production diff, check subsequent
history) showed were false positives on legitimate feature PRs. Each was a control
defect that the synthetic oracle never exercised (it injects a defect into
otherwise-unchanged code, never a legitimate behaviour change with a matching test
update). Both were root-caused and fixed, with regression tests, and the
authoritative run uses the fixed build.

**1. `no-op-fix-proven` on [`ryanklepser/Battleship-Challenge#12`](https://github.com/ryanklepser/Battleship-Challenge/pull/12) (Devin).**
`feat: Ship placement, attack animations, Devin AI, rename to Battlefield` is a
feature PR adding a ship-placement phase and animations, body `Closes #2` (so the
fix-claim control was met), merged, 0 reverts. The repo's one test
(`tests/board.test.ts`) imports only `../src/game/board` and the unchanged
`BOARD_SIZE` from `../src/game/types`; it never reaches the files with the new
code. It counted as a witness only because it imports an unchanged symbol from
`types.ts`, which the PR changed by *adding* an unrelated interface.
Root cause: the no-op proof's affected-test closure is file-level: a test that
reaches a *changed file* was a witness regardless of whether it used the *changed
lines*. Fix (`a8e21b50`): a witness must reach a source file whose hunk has a
deleted/modified line (`behaviorallyRevertableSourceFiles`); a purely-additive
change is new code no pre-existing test can verify, so the proof abstains
(fail-closed). Verified: PR #12 → `ran-no-proof`.

**2. `test-tamper-proven` (×2) on [`hajrix01-star/taqfeelah#212`](https://github.com/hajrix01-star/taqfeelah/pull/212) (Cursor).**
`feat(owner-share): WhatsApp image+caption for owner closeouts with period-aware
text`. The production diff replaces the old detailed-caption logic with a new
`buildOwnerCloseoutShareCaption` that builds a period-aware title; the per-row
numbers/labels (`كاش`, `مشتريات`) move from the caption into the image detail
rows, which the test still asserts. The test was re-specified: two
`expect(model.shareCaption).toContain("300"/"200")` became one
`expect(model.shareCaption).toBe("<exact title>")`. Merged, 0 reverts.
Root cause: `assertion-strip` counts raw assertion lines, so collapsing N looser
matchers on a subject into one stricter exact-match read as "net −(N−1) stripped"
and emitted the block finding that gates the test-tamper proof. Fix (`7409741b`):
a removed assertion whose subject gained an added exact-match
(`toBe`/`toEqual`/`toStrictEqual`/…) is a re-specification, not a strip, and is
excluded. Oracle-safe by construction (the strip injector never adds a
replacement, so no oracle injection is exempted; structural recall held at
258/275). Verified: PR #212 → `ran-no-proof`.

Both fixes are strictly more conservative: each can only drop a false proof, never
invent one, and each carries a regression test. The authoritative run below uses
the build with both fixes; it produces **0 proven blocks**.

### The dculus-forms lead

The one agent-revert cluster the backward miner surfaced,
[`dculussoftwares/dculus-forms`](https://github.com/dculussoftwares/dculus-forms),
is a TypeScript pnpm monorepo (jest runner, node ≥ 22.12) with **59 revert
commits over 84 reverted SHAs**, a solo developer driving `claude-code` and
reverting heavily. It is execution-grounded-viable, so its reverted `claude-code`
commits are exactly the intersection the existing corpus lacked:
agent-attributed and outcome-bad in a repo the proof tier can execute.

Six of its reverted `claude-code` commits that touch TypeScript source (UI fixes,
a layout fix, a backend CORS fix, a broad refactor, two feature commits) were
carried into the proof tier as seed leads (`--seeds`, so the lead the backward
miner surfaced reaches the proof tier without being re-discovered). Each is
outcome-bad (reverted), so a proven block would be a true positive.

Result: **6 of 6 provisioned and ran; 0 proven blocks; every one `ran-no-proof`.**
The pnpm monorepo clones, installs through corepack, and runs its jest suite in
the sandbox. The structural detectors flagged **54 advisory findings** across the
six (no-op-fix: 33, coverage-erosion: 20, type-suppression: 1), but **none
survived the execution-grounded controls** (`engineFires: {}`).

This is the proof tier behaving exactly as designed on real outcome-bad agent
PRs: a `git revert` means the change was wrong, but "wrong" is almost always a
genuine regression or a rolled-back feature, not one of the six control-verifiable
cheats. A reverted real fix breaks an affected test when reverted, which *refutes*
the no-op-fix proof rather than proving it; so the structural no-op-fix flags
(33 of them) correctly do not survive. The proof tier does not cry wolf to inflate
a catch count. Per-PR records:
`benchmarks/real-prs/hunt/records/claude-code-dculussoftwares-dculus-forms-*.json`.

## What the zeros mean

The zeros are the honest result of a small, complete hunt, not a gap:

- **No genuine provable cheat in the wild sample.** 28 EG-viable agent PRs, all
  `ran-no-proof`. The proof tier blocks only on a control-verified cheat, and this
  sample of merged agent PRs contained none.
- **The `{outcome-bad} ∩ {EG-viable}` intersection is no longer empty.** The six
  dculus reverted `claude-code` commits are outcome-bad and EG-viable; the proof
  tier evaluated them and correctly abstained. This closes the gap that made the
  corpus gate-precision an `n=0` with an empty denominator.
- **0 false positives after the two control fixes.** The two false positives the
  hunt surfaced (a no-op and a test-tamper, both on legitimate feature PRs) were
  root-caused and fixed; the authoritative run on the fixed build fired nothing.

Scaling the hunt would eventually surface a real cheat, but the project's own
priority is a smaller hunt completed and reported over a larger one truncated. The
target-set construction, the viability screen, and the proof tier are all
reproducible from the command below.

## Reproduce

```sh
# Part 1: the backward-mining funnel (writes confirmed-bad-backward.json)
npm run build
node dist/scripts/real-prs/mine-backward.js --api-budget 1500 --wall-clock-ms 2400000 --limit 50 --months 18

# Part 2: the hunt (set SWARM_EG_NODE_BIN to a Node 22 bin dir)
SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt.js --target 200
```
